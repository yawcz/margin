import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import {
  tutorInstructions,
  tutorPrompt,
  resultSchema,
  resolveGeneration,
  type AgentProvider,
  type TutorRequest,
} from './tutor.ts';
import type { AgentStatus, ModelCatalog, ModelOption, TutorResult } from '../shared/types.ts';

// Only this module knows Codex's protocol. Domain records never store Codex thread IDs.
export class CodexProvider implements AgentProvider {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private listeners = new Set<(method: string, params: any) => void>();
  constructor(
    private workspace: string,
    private binary = process.env.CODEX_BIN || 'codex',
  ) {}
  private async start() {
    if (this.starting) return this.starting;
    this.starting = (async () => {
      this.child = spawn(this.binary, ['app-server', '--listen', 'stdio://'], {
        cwd: this.workspace,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const fail = (error: Error) => {
        for (const call of this.pending.values()) {
          clearTimeout(call.timer);
          call.reject(error);
        }
        this.pending.clear();
        for (const fn of this.listeners) fn('provider/closed', { message: error.message });
        this.starting = undefined;
        this.child = undefined;
      };
      this.child.once('error', () =>
        fail(
          new Error('Codex could not start. Install the Codex CLI on the server, then sign in.'),
        ),
      );
      this.child.once('exit', () => fail(new Error('The Codex connection ended. Try again.')));
      // Drain stderr without forwarding provider diagnostics or credentials to browsers.
      this.child.stderr.on('data', () => {});
      createInterface({ input: this.child.stdout }).on('line', (line) => {
        let value: any;
        try {
          value = JSON.parse(line);
        } catch {
          return;
        }
        if (value.id !== undefined && !value.method) {
          const call = this.pending.get(value.id);
          if (call) {
            clearTimeout(call.timer);
            this.pending.delete(value.id);
            value.error
              ? call.reject(new Error(value.error.message || 'Codex request failed'))
              : call.resolve(value.result);
          }
        } else if (value.method && value.id !== undefined) {
          // This reader does not grant agent-initiated command, edit, or tool approvals.
          this.child?.stdin.write(
            JSON.stringify({
              id: value.id,
              error: {
                code: -32601,
                message: 'Interactive tools and approvals are unavailable in this paper reader.',
              },
            }) + '\n',
          );
        } else if (value.method) {
          for (const fn of this.listeners) fn(value.method, value.params);
        }
      });
      await this.rpc('initialize', {
        clientInfo: { name: 'margin_reader', version: '0.1.0', title: 'Margin' },
      });
      this.child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    })();
    try {
      await this.starting;
    } catch (e) {
      this.starting = undefined;
      throw e;
    }
  }
  private rpc(method: string, params: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Codex did not respond in time.'));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.child?.stdin.writable) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('Codex is not connected.'));
        return;
      }
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async status(): Promise<AgentStatus> {
    try {
      await this.start();
      const result = await this.rpc('account/read', { refreshToken: false });
      return {
        available: true,
        authenticated: !!result.account,
        name: 'Codex',
        detail: result.account
          ? 'Connected on this server'
          : 'Run codex login on the server to connect your ChatGPT account.',
      };
    } catch {
      return {
        available: false,
        authenticated: false,
        name: 'Codex',
        detail: 'Install Codex on the server, then run codex login.',
      };
    }
  }
  async models(): Promise<ModelCatalog> {
    await this.start();
    const models: ModelOption[] = [];
    let cursor: string | undefined;
    let recommended = '';
    do {
      const result = await this.rpc('model/list', {
        limit: 100,
        includeHidden: false,
        ...(cursor ? { cursor } : {}),
      });
      for (const model of result.data) {
        if (model.isDefault) recommended = model.model;
        models.push({
          id: model.model,
          name: model.displayName || model.model,
          defaultEffort: model.defaultReasoningEffort,
          efforts: model.supportedReasoningEfforts.map(
            (effort: { reasoningEffort: string; description: string }) => ({
              id: effort.reasoningEffort,
              description: effort.description,
            }),
          ),
          supportsImages: (model.inputModalities ?? ['text', 'image']).includes('image'),
        });
      }
      cursor = result.nextCursor ?? undefined;
    } while (cursor);
    const { config } = await this.rpc('config/read', { includeLayers: false, cwd: this.workspace });
    return { models, defaultModel: process.env.CODEX_MODEL || config.model || recommended };
  }
  async answer(request: TutorRequest): Promise<TutorResult> {
    const catalog = await this.models();
    const generation = resolveGeneration(catalog, request.generation);
    const model = catalog.models.find((item) => item.id === generation.model)!;
    const { thread } = await this.rpc('thread/start', {
      cwd: this.workspace,
      ephemeral: true,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      baseInstructions: tutorInstructions,
      config: {
        'features.shell_tool': false,
        'features.apply_patch_freeform': false,
        'features.multi_agent': false,
        project_doc_max_bytes: 0,
        web_search: 'live',
      },
      model: generation.model,
    });
    const output = await new Promise<string>((resolve, reject) => {
      let finalText = '';
      let deltaText = '';
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(listener);
      };
      const timer = setTimeout(() => {
        cleanup();
        void this.rpc('thread/archive', { threadId: thread.id }).catch(() => {});
        reject(new Error('The tutor took too long. Your question is saved; please try again.'));
      }, 240000);
      const listener = (method: string, params: any) => {
        if (method === 'provider/closed') {
          cleanup();
          reject(new Error(params.message));
          return;
        }
        if (params?.threadId !== thread.id) return;
        if (method === 'item/agentMessage/delta') deltaText += params.delta || '';
        if (method === 'item/completed' && params.item?.type === 'agentMessage')
          finalText = params.item.text || finalText;
        if (method === 'turn/completed') {
          cleanup();
          if (params.turn?.status === 'failed' || params.turn?.status === 'interrupted')
            reject(
              new Error(
                params.turn?.error?.message || 'The tutor could not finish. Please try again.',
              ),
            );
          else resolve(finalText || deltaText);
        }
      };
      this.listeners.add(listener);
      const input: any[] = [{ type: 'text', text: tutorPrompt(request) }];
      if (request.imagePath && model.supportsImages)
        input.push({ type: 'localImage', path: request.imagePath });
      void this.rpc('turn/start', {
        threadId: thread.id,
        input,
        outputSchema: z.toJSONSchema(resultSchema),
        model: generation.model,
        effort: generation.effort,
      }).catch((error) => {
        cleanup();
        reject(error);
      });
    });
    void this.rpc('thread/archive', { threadId: thread.id }).catch(() => {});
    try {
      return resultSchema.parse(JSON.parse(output));
    } catch {
      throw new Error(
        'The tutor returned an unreadable response. Your question is saved; please try again.',
      );
    }
  }
  close() {
    this.child?.kill();
  }
}
