import { describe, expect, it } from 'vitest';
import { analyzePrompt } from '../src/index.js';

const COMPLETE_COURSE_PROMPT = `Actúa como mi analista. Primero lee mi brief, después la tabla adjunta, y luego haz exactamente lo que te pido.

MI BRIEF
Soy gerente de operaciones en una empresa de logística y reporto a dirección general. Este reporte es para la reunión mensual de comité.

LA TABLA
El archivo viene del ERP de entregas, cubre el último trimestre y la columna estado indica si el envío llegó a tiempo o con retraso.

LO QUE TE PIDO
Crea un documento de máximo una página con cuatro secciones y una tabla resumen en tono directo y profesional.

REGLAS
- Calcula las cifras a partir de la tabla; no estimes ni inventes datos.
- Si falta algún dato, escribe [FALTA: qué dato].`;

describe('Claude challenge guidelines integration', () => {
  describe('structureCheck (5-part prompt anatomy)', () => {
    it('is off by default so short prose prompts are not penalized', () => {
      const result = analyzePrompt('¿Cómo puedo optimizar una consulta SQL lenta en Postgres?');
      expect(result.valid).toBe(true);
      expect(result.action).toBe('allow');
      expect(result.findings.some((f) => f.code === 'PROMPT_STRUCTURE_INCOMPLETE')).toBe(false);
    });

    it('allows a complete 5-part Spanish prompt without injection false positives', () => {
      const result = analyzePrompt(COMPLETE_COURSE_PROMPT, { structureCheck: 'advisory' });
      expect(result.valid).toBe(true);
      expect(result.action).toBe('allow');
      expect(result.findings.some((f) => f.code === 'PROMPT_STRUCTURE_INCOMPLETE')).toBe(false);
      expect(result.findings.some((f) => f.ruleId === 'injection')).toBe(false);
    });

    it('warns in advisory mode when fewer than 3 pillars are present', () => {
      const result = analyzePrompt('Resume este texto sobre ventas del trimestre pasado.', {
        structureCheck: 'advisory',
      });
      expect(result.valid).toBe(true);
      expect(result.action).toBe('warn');
      const finding = result.findings.find((f) => f.code === 'PROMPT_STRUCTURE_INCOMPLETE');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('warn');
      expect(finding?.metadata?.score).toBeLessThan(3);
      expect(Array.isArray(finding?.metadata?.suggestions)).toBe(true);
    });

    it('emits info in advisory mode when 3 or 4 pillars are present', () => {
      const partial = `Actúa como mi analista.
MI BRIEF: Soy líder de producto y este informe es para dirección.
FORMATO: Entrégalo en máximo una página con secciones claras.`;
      const result = analyzePrompt(partial, { structureCheck: 'advisory' });
      expect(result.valid).toBe(true);
      expect(result.action).toBe('allow');
      const finding = result.findings.find((f) => f.code === 'PROMPT_STRUCTURE_INCOMPLETE');
      expect(finding?.severity).toBe('info');
      expect(finding?.metadata?.score).toBe(3);
    });

    it('blocks in strict mode when fewer than 3 pillars are present', () => {
      const result = analyzePrompt('Haz un resumen rápido del documento adjunto.', {
        structureCheck: 'strict',
      });
      expect(result.valid).toBe(false);
      expect(result.action).toBe('block');
      expect(result.findings.some((f) => f.code === 'PROMPT_STRUCTURE_INCOMPLETE')).toBe(true);
    });

    it('skips structure checks in code mode', () => {
      const codePrompt = `\`\`\`ts
export function sum(a: number, b: number) {
  return a + b;
}
\`\`\``;
      const result = analyzePrompt(codePrompt, { structureCheck: 'strict' });
      expect(result.valid).toBe(true);
      expect(result.findings.some((f) => f.code === 'PROMPT_STRUCTURE_INCOMPLETE')).toBe(false);
    });
  });

  describe('quality rule enhancements (Spanish placeholders & padding)', () => {
    it('warns on unrendered Spanish template placeholders', () => {
      const template =
        'Eres el asistente de [tu nombre o tu cargo]. MI BRIEF: [pega aquí tus 4 líneas]';
      const result = analyzePrompt(template);
      expect(result.action).toBe('warn');
      expect(result.findings.some((f) => f.code === 'UNRENDERED_PLACEHOLDER')).toBe(true);
    });

    it('does not flag intentional [FALTA] or [SUPUESTO] output markers', () => {
      const prompt =
        'Redacta el informe con mis datos. Donde falte información escribe [FALTA: qué dato] y marca con [SUPUESTO] cualquier inferencia.';
      const result = analyzePrompt(prompt);
      expect(result.findings.some((f) => f.code === 'UNRENDERED_PLACEHOLDER')).toBe(false);
    });

    it('warns on low lexical diversity in longer prose prompts', () => {
      const padded =
        'revisa este texto sobre ventas costos gastos ingresos clientes equipo revisa texto sobre ventas costos gastos ingresos clientes equipo revisa ventas costos gastos ingresos clientes equipo';
      const result = analyzePrompt(padded);
      expect(result.action).toBe('warn');
      expect(result.findings.some((f) => f.code === 'LOW_PROSE_DIVERSITY')).toBe(true);
    });

    it('warns on repeated substring padding in prose prompts', () => {
      const repeatedClause = 'analiza este reporte mensual de operaciones ';
      const prompt = `${repeatedClause}${repeatedClause}${repeatedClause}y dame conclusiones distintas sobre logística, finanzas, inventario, calidad y tiempos de entrega.`;
      const result = analyzePrompt(prompt);
      expect(result.action).toBe('warn');
      expect(result.findings.some((f) => f.code === 'REPEATED_PHRASE_PADDING')).toBe(true);
    });

    it('recognizes natural Spanish 5-pillar phrasing (e.g. "en menos de", "evita", "llevo X años")', () => {
      const prompt =
        'Actúa como un asesor de carrera profesional. Contexto: Llevo 2 años en la empresa y este mensaje es para mi superior. Objetivo: Solicita una reunión de revisión salarial. Formato: En menos de 150 palabras con tono educado. Reglas: Evita la jerga innecesaria y no inventes métricas.';
      const result = analyzePrompt(prompt, { structureCheck: 'advisory' });

      expect(result.action).toBe('allow');
      expect(result.findings).toHaveLength(0);
    });
  });
});
