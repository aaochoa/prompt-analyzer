import { getFindingMessage, resolveUiLanguage } from '../i18n.js';
import type { AnalyzerRule, Finding, PromptContext, Severity } from '../types.js';

export type StructurePillarId =
    'roleOrTask' | 'context' | 'objectiveOrProcess' | 'outputFormat' | 'constraints';

interface StructurePillar {
    id: StructurePillarId;
    label: { es: string; en: string };
    suggestion: { es: string; en: string };
    pattern: RegExp;
}

const STRUCTURE_PILLARS: readonly StructurePillar[] = [
    {
        id: 'roleOrTask',
        label: { es: 'Rol o tarea', en: 'Role or task' },
        suggestion: {
            es: 'Define el rol del modelo o el modo de trabajo inicial (p. ej. "Actúa como mi analista" o "Primero entrevístame antes de escribir").',
            en: 'Define the model role or initial working mode (e.g., "Act as my analyst" or "Interview me first before writing").',
        },
        pattern:
            /(?<!\p{L})(?:actua como|eres (?:el|la|un|una|mi) (?:asistente|experto|desarrollador|analista|profesor|asesor|redactor|gestor)|asistente de|trabaja como|comportate como|quiero que me ayudes|necesito que|primero entrevistame|no lo escribas todavia|haz exactamente lo que te pido|cada vez que te comparta|act as|you are (?:a|an|the|my)|work as|behave like|help me (?:write|create|analyze|draft)|interview me first|do not write it yet|don't write it yet)(?!\p{L})/u,
    },
    {
        id: 'context',
        label: { es: 'Contexto', en: 'Context' },
        suggestion: {
            es: 'Agrega tu contexto o audiencia (p. ej. quién eres, tu área, para quién es el resultado y qué te importa).',
            en: 'Add your context or audience (e.g., who you are, your team, who will read the output, and what matters).',
        },
        pattern:
            /(?<!\p{L})(?:mi brief|brief de|contexto|antecedentes|mi rol|mi area|reporto a|para quien|audiencia|quien lo va a leer|dirigido a|mi empresa|mi equipo|llevo \d+ anos|my brief|context|audience|target reader|background|my role|my team|my company|for \d+ years|aimed at)(?!\p{L})/u,
    },
    {
        id: 'objectiveOrProcess',
        label: { es: 'Objetivo, datos o proceso', en: 'Objective, data, or process' },
        suggestion: {
            es: 'Especifica el objetivo, el origen de los datos o el proceso paso a paso que debe seguir el modelo.',
            en: 'Specify the objective, data source, or step-by-step process the model should follow.',
        },
        pattern:
            /(?<!\p{L})(?:lo que tengo que escribir|lo que te pido|tarea|objetivo|proceso|paso \d+|primero [^\n]{0,40} despues|la tabla|de donde sale|que periodo cubre|indica de donde sale|cita la fuente|objective|goal|task|process|step \d+|step by step|first [^\n]{0,40} then|cite (?:the )?sources?)(?!\p{L})/u,
    },
    {
        id: 'outputFormat',
        label: { es: 'Formato de salida', en: 'Output format' },
        suggestion: {
            es: 'Indica el formato esperado: secciones, extensión máxima, tabla/lista, tono o dinámica de respuesta.',
            en: 'Specify the expected output format: sections, max length, table/list, tone, or response style.',
        },
        pattern:
            /(?<!\p{L})(?:formato|secciones|seccion \d+|maximo \d+|maximo una pagina|en menos de \d+ (?:palabras|caracteres)|menos de \d+ (?:palabras|caracteres)|una pagina|con titulos|subtitulos|tabla resumen|grafico|lista con|en (?:una )?lista|en formato \p{L}+|tono \p{L}+|una pregunta a la vez|extension|output format|sections|max \d+|under \d+ words|less than \d+ words|bulleted list|summary table|tone|one question at a time)(?!\p{L})/u,
    },
    {
        id: 'constraints',
        label: { es: 'Restricciones y reglas', en: 'Constraints and rules' },
        suggestion: {
            es: 'Incluye reglas anti-alucinación y de control (p. ej. "No inventes datos", "Usa solo lo que te dije", "Si falta un dato, escribe [FALTA]").',
            en: 'Include anti-hallucination and control rules (e.g., "Do not invent data", "Only use what I provided", "If data is missing, write [MISSING]").',
        },
        pattern:
            /(?<!\p{L})(?:reglas|restricciones|no inventes|no estimes|evita (?:la |el )?\p{L}+|no uses|usa solo|basate (?:solo|unicamente)|calcula las cifras|donde falte|si falta|si no corresponde|responde siempre en|revisa antes de entregar|do not invent|don't invent|do not guess|avoid \p{L}+|only use|based only on|unless|constraints|rules|if missing)(?!\p{L})|\[(?:falta|supuesto|missing)\b/u,
    },
];

function resolveSeverity(mode: 'advisory' | 'strict', score: number): Severity {
    if (mode === 'strict') {
        return score < 3 ? 'block' : 'warn';
    }
    return score < 3 ? 'warn' : 'info';
}

/**
 * Evaluates whether a prose prompt follows the 5-part prompt anatomy
 * (role/task, context, objective/process, output format, constraints).
 * Disabled when `config.structureCheck === 'off'` or in `code` mode.
 */
export const structureRule: AnalyzerRule = {
    id: 'structure',
    run(ctx: PromptContext) {
        const { structureCheck } = ctx.config;
        if (structureCheck === 'off' || ctx.mode === 'code' || ctx.matchWords.length === 0) {
            return { findings: [] };
        }

        const presentParts: StructurePillarId[] = [];
        const missingPillars: StructurePillar[] = [];

        for (const pillar of STRUCTURE_PILLARS) {
            if (pillar.pattern.test(ctx.matchText)) {
                presentParts.push(pillar.id);
            } else {
                missingPillars.push(pillar);
            }
        }

        const uiLang = resolveUiLanguage(ctx.detectedLanguage);
        const score = presentParts.length;
        if (score === STRUCTURE_PILLARS.length) {
            return { findings: [] };
        }

        const missingLabels = missingPillars.map((p) => p.label[uiLang]).join(', ');
        const findings: Finding[] = [
            {
                code: 'PROMPT_STRUCTURE_INCOMPLETE',
                ruleId: 'structure',
                severity: resolveSeverity(structureCheck, score),
                message: getFindingMessage('PROMPT_STRUCTURE_INCOMPLETE', ctx.detectedLanguage, {
                    score,
                    maxScore: STRUCTURE_PILLARS.length,
                    missing: missingLabels,
                }),
                metadata: {
                    score,
                    maxScore: STRUCTURE_PILLARS.length,
                    presentParts,
                    missingParts: missingPillars.map((p) => p.id),
                    suggestions: missingPillars.map((p) => p.suggestion[uiLang]),
                },
            },
        ];

        return { findings };
    },
};
