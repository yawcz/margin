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

// Connectivity failures are reported as 503 so clients can retry rather than treat them as bad input.
const providerError = (message: string) => Object.assign(new Error(message), { status: 503 });

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
    // `||` rather than `??`: the container may receive an empty string from compose.
    private timeoutMs = Number(process.env.TUTOR_TIMEOUT_MS) || 600000,
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
          providerError(
            'Codex could not start. Install the Codex CLI on the server, then sign in.',
          ),
        ),
      );
      this.child.once('exit', () => fail(providerError('The Codex connection ended. Try again.')));
      // Provider diagnostics go to the server log only; they are never forwarded to browsers.
      this.child.stderr.on('data', (chunk) => {
        const text = String(chunk).trim();
        if (text) console.error('[codex]', text);
      });
      // A hung-up child makes stdin writes fail (EPIPE); without a listener that would crash Margin.
      this.child.stdin.on('error', (error) => {
        console.error('[codex] stdin', error.message);
        this.child?.kill();
      });
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
          if (this.child?.stdin.writable)
            this.child.stdin.write(
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
      if (this.child.stdin.writable)
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
        reject(providerError('Codex did not respond in time.'));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.child?.stdin.writable) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(providerError('Codex is not connected.'));
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
    } catch (error) {
      return {
        available: false,
        authenticated: false,
        name: 'Codex',
        detail:
          error instanceof Error
            ? error.message
            : 'Install Codex on the server, then run codex login.',
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
    // Only an available model can be the default; otherwise every request would fail until one is saved.
    const defaultModel =
      [process.env.CODEX_MODEL, config?.model, recommended, models[0]?.id].find(
        (id) => id && models.some((model) => model.id === id),
      ) ?? '';
    return { models, defaultModel };
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
      // Paper text is untrusted input, so every agent tool except web search is switched off.
      // Feature names verified against `codex features list` for 0.154; recheck on upgrades.
      config: {
        'features.shell_tool': false,
        'features.unified_exec': false,
        'features.unified_exec_tty': false,
        'features.multi_agent': false,
        'features.browser_use': false,
        'features.computer_use': false,
        'features.apps': false,
        'features.code_mode_host': false,
        'features.plugins': false,
        'features.image_generation': false,
        'features.view_image': false,
        mcp_servers: {},
        project_doc_max_bytes: 0,
        web_search: 'live',
      },
      model: generation.model,
    });
    let output: string;
    try {
      output = await new Promise<string>((resolve, reject) => {
        let finalText = '';
        let deltaText = '';
        let turnId = '';
        const cleanup = () => {
          clearTimeout(timer);
          this.listeners.delete(listener);
        };
        const timer = setTimeout(() => {
          cleanup();
          // Stop the turn so it does not keep consuming the account's usage after we give up.
          if (turnId)
            void this.rpc('turn/interrupt', { threadId: thread.id, turnId }).catch(() => {});
          reject(new Error('The tutor took too long. Your question is saved; please try again.'));
        }, this.timeoutMs);
        const listener = (method: string, params: any) => {
          if (method === 'provider/closed') {
            cleanup();
            reject(providerError(params.message));
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
        this.rpc('turn/start', {
          threadId: thread.id,
          input,
          outputSchema: z.toJSONSchema(resultSchema),
          model: generation.model,
          effort: generation.effort,
        }).then(
          (result) => {
            turnId = result?.turn?.id ?? '';
          },
          (error) => {
            cleanup();
            reject(error);
          },
        );
      });
    } finally {
      void this.rpc('thread/archive', { threadId: thread.id }).catch(() => {});
    }
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
