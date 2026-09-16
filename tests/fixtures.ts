import type { AgentProvider, TutorRequest } from '../server/tutor.ts';
import type { ModelCatalog, TutorResult } from '../shared/types.ts';

// Deliberately confined to tests. The shipped application only uses real agents.
export class TestProvider implements AgentProvider {
  calls: TutorRequest[] = [];
  catalog: ModelCatalog = {
    defaultModel: 'test-model',
    models: [
      {
        id: 'test-model',
        name: 'Test model',
        supportsImages: true,
        defaultEffort: 'medium',
        efforts: [
          { id: 'low', description: 'Faster replies' },
          { id: 'medium', description: 'Balanced reasoning' },
          { id: 'high', description: 'More reasoning' },
        ],
      },
      {
        id: 'text-model',
        name: 'Text model',
        supportsImages: false,
        defaultEffort: 'low',
        efforts: [
          { id: 'low', description: 'Faster replies' },
          { id: 'high', description: 'More reasoning' },
        ],
      },
    ],
  };
  constructor(
    private delay = 30,
    private fail = false,
  ) {}
  async status() {
    return {
      available: true,
      authenticated: true,
      name: 'Test provider',
      detail: 'Test-only provider',
    };
  }
  async models() {
    return this.catalog;
  }
  async answer(request: TutorRequest): Promise<TutorResult> {
    this.calls.push(request);
    await new Promise((resolve) => setTimeout(resolve, this.delay));
    if (this.fail) throw new Error('Test provider unavailable');
    if (request.action === 'quiz')
      return {
        answer:
          'If a new difference vector is $(0,5)$, does it lie in the same subspace as $(0,2)$? Explain your reasoning.',
        quizSuggested: false,
        quizReason: '',
        signals: [],
        recommendations: [],
      };
    if (request.action === 'feedback')
      return {
        answer:
          'Yes. Your explanation uses the defining property: $(0,5)=2.5(0,2)$, so it belongs to the span.',
        quizSuggested: false,
        quizReason: '',
        signals: [
          {
            concept: 'One-dimensional subspaces',
            assessment: 'Explained membership using scalar multiplication.',
            evidence: request.question,
            confidence: 'supported',
          },
        ],
        recommendations: [],
      };
    if (request.question === 'Show a long explanation for the reader test.')
      return {
        answer:
          Array.from(
            { length: 10 },
            (_, i) =>
              `Step ${i + 1}: A direction describes a relationship between vectors. Multiplying a nonzero vector by a scalar keeps it in the same one-dimensional subspace. The point is the shared geometric relationship, even when individual vectors have different lengths.`,
          ).join('\n\n') + '\n\nThe final check is $v+0=v$. [p. 2](#page=2)',
        quizSuggested: false,
        quizReason: '',
        signals: [],
        recommendations: [],
      };
    return {
      answer:
        'A **one-dimensional subspace** is a line through the origin. Formally, $S=\\operatorname{span}\\{v\\}=\\{av:a\\in\\mathbb R\\}$. The shared direction of paired differences motivates the interpretation. [p. 1](#page=1)',
      quizSuggested: true,
      quizReason: 'Try applying the definition to a different vector.',
      signals: [
        {
          concept: 'Concept directions',
          assessment: 'Would like a bridge from a geometric subspace to its interpretation.',
          evidence: request.question,
          confidence: 'tentative',
        },
      ],
      recommendations: [
        {
          title: 'The Linear Representation Hypothesis and the Geometry of Large Language Models',
          url: 'https://arxiv.org/abs/2311.03658',
          reason: 'Revisit the definition of the concept direction after the toy example.',
          kind: 'background',
          effort: 'Section 2 · 10 min',
        },
      ],
    };
  }
  close() {}
}
export function samplePdf(): Buffer {
  const contents = [
    'BT /F1 18 Tf 55 750 Td (A Small Paper About Concept Directions) Tj 0 -35 Td /F1 12 Tf (A concept can be represented by a shared direction.) Tj 0 -25 Td (The subspace is the span of a nonzero difference vector.) Tj 0 -25 Td (Think of a line through the origin. Ask why this is natural.) Tj 0 -610 Td (This argument continues across the page boundary.) Tj ET',
    'BT /F1 18 Tf 55 750 Td (Checking the Idea) Tj 0 -35 Td /F1 12 Tf (Does the vector zero belong to every linear subspace?) Tj 0 -25 Td (Try to explain your reasoning in a new example.) Tj ET',
  ];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...contents.map(
      (text) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    ),
  ];
  return pdfFromObjects(objects);
}

export function multilingualPdf(): Buffer {
  const contents =
    'BT /F2 14 Tf 55 750 Td (Multilingual selection regression fixture.) Tj 0 -35 Td /F1 18 Tf <65E5672C8A9E> Tj ET';
  return pdfFromObjects([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 8 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(contents)} >>\nstream\n${contents}\nendstream`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3 /Encoding /UniJIS-UTF16-H /DescendantFonts [6 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiMin-W3 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 5 >> /FontDescriptor 7 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /HeiseiMin-W3 /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

function pdfFromObjects(objects: string[]): Buffer {
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
      .join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
