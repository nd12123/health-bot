import XLSX from 'xlsx';
import type { MedicalCard } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Export medical card to Excel file (fills template)
 * Minimal approach: fill existing template cells with bot data only
 *
 * Maps to actual "Медицинская карта (1)" sheet structure
 */
export async function exportMedicalCardToExcel(card: MedicalCard, outputPath: string): Promise<string> {
  try {
    // Read template
    const templatePath = path.join(process.cwd(), 'Медицинская карта (1) ИВ 2025.xlsx');

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${templatePath}`);
    }

    // Load workbook and get the correct sheet
    const templateWorkbook = XLSX.readFile(templatePath);
    const sheetName = 'Медкарта-1'; // Explicitly use the correct sheet

    if (!templateWorkbook.Sheets[sheetName]) {
      throw new Error(`Sheet "${sheetName}" not found in template`);
    }

    const sourceWorksheet = templateWorkbook.Sheets[sheetName];

    // Fill template cells with actual data
    // Pattern: Question is in column A (merged), answer goes in the NEXT column after the merge
    const mapping: Record<string, string | number> = {
      // Row 8: Write to merge START cells with question + answer format
      // A8:D9 for date, E8:N9 for name
      'A8': `Дата заполнения: ${new Date().toISOString().split('T')[0]}`,
      'E8': `Ф.И.О. ${card.demographics.full_name || ''}`,

      // Row 10: Sex, DOB, Marital Status
      'A10': `Пол: ${card.demographics.sex || ''}`,
      'E10': `Дата рождения: ${card.demographics.date_of_birth || ''}`,
      'J10': `Семейное положение: ${card.demographics.marital_status || ''}`,

      // Row 12: Phone, Clinic, Recommended
      'A12': `Телефон: ${card.demographics.phone_number || ''}`,
      'E12': `Как узнали о клинике: ${''}`,
      'J12': `Кто порекомендовал: ${''}`,

      // Row 14: Occupation
      'A14': `Вид деятельности: ${card.medical_history?.occupation || ''}`,

      // Row 17: Chief Complaint - question in A17:N18 merge
      // Row 19-20: Answer goes in A19:N20 merge (empty merge row)
      'A19': card.chief_complaint?.complaint || '', // Жалобы answer

      // Row 21-22: Aggravating and alleviating factors combined in A21:N22 merge
      'A21': `Провоцирующие факторы: ${card.chief_complaint?.aggravating_factors || ''}\nОблегчающие факторы: ${card.chief_complaint?.alleviating_factors || ''}`,

      // Row 29: History of condition
      'B29': card.chief_complaint?.history_of_condition || '', // Анамнез заболевания (question in A29, answer in B29)

      // Row 34: Syndrome description
      'B34': card.chief_complaint?.complaint || '', // Синдром: (question in A34:B35, answer in B34)

      // Row 36: Medical history of life
      'B36': card.medical_history?.previous_symptoms_details || '', // Анамнез жизни (question in A36, answer in B36)

      // Row 37: Checkbox items - each has checkbox cells and answer cells next to them
      // Аутоимунная бол. (A37:B38) → answer in B37
      // Метаб. Синдром (C37:D38) → answer in D37
      // Инфекц. бол. (E37:F38) → answer in F37
      // Аллергия (G37:H38) → answer in H37
      // Кардиостимулятор (I37:J38) → answer in J37
      // Онкология (K37:L38) → answer in L37
      // Беременность (M37:N38) → answer in N37
      'B37': card.medical_history?.chronic_diseases?.includes('Аутоимунная') ? 'Да' : '', // Аутоимунная бол.
      'D37': card.medical_history?.chronic_diseases?.includes('Метаб. Синдром') ? 'Да' : '', // Метаб. Синдром
      'F37': card.medical_history?.chronic_diseases?.includes('Инфекц.') ? 'Да' : '', // Инфекц. бол.
      'H37': card.medical_history?.allergies && card.medical_history.allergies.length > 0 ? card.medical_history.allergies.join('; ') : 'Нет', // Аллергия
      'J37': card.medical_history?.chronic_diseases?.includes('Кардиостимулятор') ? 'Да' : '', // Кардиостимулятор
      'L37': card.medical_history?.chronic_diseases?.includes('Онкология') ? 'Да' : '', // Онкология
      'N37': card.medical_history?.pregnancy_or_breastfeeding && card.medical_history.pregnancy_or_breastfeeding !== 'no' && card.medical_history.pregnancy_or_breastfeeding !== 'not_applicable' ? 'Да' : 'Нет', // Беременность

      // Row 42: Instrumental examinations
      'B42': '', // Инструментальные исследования (question in A42:N43, answer in B42)

      // Row 44: Laboratory examinations
      'B44': '', // Лабораторные исследования (question in A44:N45, answer in B44)

      // Row 47: Main diagnosis and other diagnoses
      'B47': card.assessment?.preliminary_diagnosis || '', // Основной: (question in A47:B48, answer in B47)
      'D47': card.assessment?.likely_causes?.map(c => c.name).join('; ') || '', // Additional diagnoses can go in D47, E47, etc.

      // Row 61: Additional notes (Другое:)
      'B61': card.assessment?.likely_causes?.map(c => `${c.name}: ${c.rationale}`).join('; ') || '', // Additional analysis (question in A61:A62, answer in B61)

      // Row 74: Date of visit
      'B74': new Date().toISOString().split('T')[0], // Дата посещения (question in A74:B75, answer in B74)

      // Row 76: Notes and comments
      'B76': card.assessment?.doctor_notes || '', // Заметки и комментарии: (question in A76:B77, answer in B76)
    };

    // Fill worksheet
    for (const [cell, value] of Object.entries(mapping)) {
      if (value !== undefined && value !== null && value !== '') {
        sourceWorksheet[cell] = { t: 's', v: String(value) };
      }
    }

    // Helper function to update checkbox cells
    // Convert Cyrillic 'О' (U+041E) to proper checkbox symbols '○' (U+25CB) and '☑' (U+2611)
    const fixCheckboxCell = (cell: any, replacements: Array<{pattern: string; withCheck: boolean}>) => {
      if (!cell || typeof cell.v !== 'string') return;

      // First pass: convert Cyrillic 'О' to proper '○' circle character
      let text = cell.v.replace(/О /g, '○ ');

      // Apply specific checkbox replacements
      for (const repl of replacements) {
        if (repl.withCheck) {
          // Replace '○ pattern' with '☑ pattern'
          text = text.replace(`○ ${repl.pattern}`, `☑ ${repl.pattern}`);
        } else {
          // Keep as '○ pattern'
          text = text.replace(`☑ ${repl.pattern}`, `○ ${repl.pattern}`);
        }
      }

      cell.v = text;
    };

    // Handle checkbox marking for OR questions

    // Row 30: Duration chronization
    if (card.chief_complaint?.symptom_duration) {
      const durCell = sourceWorksheet['A30'];
      fixCheckboxCell(durCell, [
        { pattern: 'до 2 недель', withCheck: card.chief_complaint.symptom_duration === 'до 2 недель' },
        { pattern: 'более 2 недель', withCheck: card.chief_complaint.symptom_duration === 'более 2 недель' },
        { pattern: 'более 4 месяцев', withCheck: card.chief_complaint.symptom_duration === 'более 4 месяцев' },
      ]);
    }

    // Row 30: Condition type (spontaneous/trauma/chronic/post-op)
    if (card.chief_complaint?.condition_type) {
      const typeCell = sourceWorksheet['H30'];
      fixCheckboxCell(typeCell, [
        { pattern: 'спонтанная', withCheck: card.chief_complaint.condition_type === 'acute' },
        { pattern: 'травматическая', withCheck: card.chief_complaint.condition_type === 'trauma' },
        { pattern: 'хроническая', withCheck: card.chief_complaint.condition_type === 'chronic' },
        { pattern: 'постоперационная', withCheck: card.chief_complaint.condition_type === 'post-operative' },
      ]);
    }

    // Row 32: Pain type
    if (card.chief_complaint?.pain_type) {
      const painTypeCell = sourceWorksheet['A32'];
      fixCheckboxCell(painTypeCell, [
        { pattern: 'стартовая', withCheck: card.chief_complaint.pain_type === 'стартовая' },
        { pattern: 'механическая', withCheck: card.chief_complaint.pain_type === 'механическая' },
        { pattern: 'постояннная', withCheck: card.chief_complaint.pain_type === 'постояннная' },
        { pattern: 'пароксизмальная', withCheck: card.chief_complaint.pain_type === 'пароксизмальная' },
      ]);
    }

    // Row 32: Pain distribution
    if (card.chief_complaint?.pain_distribution) {
      const painDistCell = sourceWorksheet['H32'];
      fixCheckboxCell(painDistCell, [
        { pattern: 'локализованная', withCheck: card.chief_complaint.pain_distribution === 'локализованная' },
        { pattern: 'иррадирующая', withCheck: card.chief_complaint.pain_distribution === 'иррадирующая' },
        { pattern: 'генерализованная', withCheck: card.chief_complaint.pain_distribution === 'генерализованная' },
        { pattern: 'летучая', withCheck: card.chief_complaint.pain_distribution === 'летучая' },
      ]);
    }

    // Row 34: Syndrome type
    if (card.chief_complaint?.syndrome_type) {
      const syndromeCell = sourceWorksheet['C34'];
      fixCheckboxCell(syndromeCell, [
        { pattern: 'ноцицептивная', withCheck: card.chief_complaint.syndrome_type === 'ноцицептивная' },
        { pattern: 'нейропатическая', withCheck: card.chief_complaint.syndrome_type === 'нейропатическая' },
        { pattern: 'метаболическая', withCheck: card.chief_complaint.syndrome_type === 'метаболическая' },
        { pattern: 'ноципластическая', withCheck: card.chief_complaint.syndrome_type === 'ноципластическая' },
      ]);
    }

    // Row 39-40: Medical condition presence (есть/нет)
    // Mark condition presence checkboxes based on chronic_diseases and allergies
    const conditionCheckboxes = [
      {
        cell: 'A39',
        hasYes: card.medical_history?.chronic_diseases?.includes('Аутоимунная') || false
      },
      {
        cell: 'C39',
        hasYes: card.medical_history?.chronic_diseases?.includes('Метаб. Синдром') || false
      },
      {
        cell: 'E39',
        hasYes: card.medical_history?.chronic_diseases?.some(d => d.includes('Инфекц')) || false
      },
      {
        cell: 'G39',
        hasYes: (card.medical_history?.allergies && card.medical_history.allergies.length > 0) || false
      },
      {
        cell: 'I39',
        hasYes: card.medical_history?.chronic_diseases?.includes('Кардиостимулятор') || false
      },
      {
        cell: 'K39',
        hasYes: card.medical_history?.chronic_diseases?.includes('Онкология') || false
      },
      {
        cell: 'M39',
        hasYes: card.medical_history?.pregnancy_or_breastfeeding && card.medical_history.pregnancy_or_breastfeeding !== 'no' && card.medical_history.pregnancy_or_breastfeeding !== 'not_applicable' || false
      },
    ];

    for (const checkbox of conditionCheckboxes) {
      const cell = sourceWorksheet[checkbox.cell];
      fixCheckboxCell(cell, [
        { pattern: 'есть', withCheck: checkbox.hasYes },
        { pattern: 'нет', withCheck: !checkbox.hasYes },
      ]);
    }

    // Row 50: Assessment severity (spread across C50, G50, K50)
    if (card.assessment?.severity) {
      // Mark only the cell corresponding to the selected severity
      const severityC50 = sourceWorksheet['C50'];
      const severityG50 = sourceWorksheet['G50'];
      const severityK50 = sourceWorksheet['K50'];

      // Mark Умеренное (C50)
      if (severityC50 && typeof severityC50.v === 'string') {
        severityC50.v = card.assessment.severity === 'Умеренное'
          ? severityC50.v.replace(/О /, '☑ ')
          : severityC50.v.replace(/☑ /, 'О ');
      }

      // Mark Выраженное (G50)
      if (severityG50 && typeof severityG50.v === 'string') {
        severityG50.v = card.assessment.severity === 'Выраженное'
          ? severityG50.v.replace(/О /, '☑ ')
          : severityG50.v.replace(/☑ /, 'О ');
      }

      // Mark Запущенное (K50)
      if (severityK50 && typeof severityK50.v === 'string') {
        severityK50.v = card.assessment.severity === 'Запущенное'
          ? severityK50.v.replace(/О /, '☑ ')
          : severityK50.v.replace(/☑ /, 'О ');
      }
    }

    // Row 92: Treatment changes (follow-up)
    if (card.assessment?.changes) {
      const changesCell = sourceWorksheet['H92'];
      fixCheckboxCell(changesCell, [
        { pattern: 'хуже', withCheck: card.assessment.changes === 'хуже' },
        { pattern: 'лучше', withCheck: card.assessment.changes === 'лучше' },
        { pattern: 'нейтрально', withCheck: card.assessment.changes === 'нейтрально' },
      ]);
    }

    // Row 94: Discharge status
    if (card.assessment?.discharge_status) {
      const dischargeCell = sourceWorksheet['H94'];
      fixCheckboxCell(dischargeCell, [
        { pattern: 'есть эффект', withCheck: card.assessment.discharge_status === 'есть эффект' },
        { pattern: 'нет эффекта', withCheck: card.assessment.discharge_status === 'нет эффекта' },
        { pattern: 'будет наблюдать', withCheck: card.assessment.discharge_status === 'будет наблюдать' },
      ]);
    }

    // Row 96: Follow-up timing
    if (card.assessment?.follow_up_timing) {
      const followUpCell = sourceWorksheet['H96'];
      fixCheckboxCell(followUpCell, [
        { pattern: 'ч/з 2 недели', withCheck: card.assessment.follow_up_timing === 'ч/з 2 недели' },
        { pattern: 'ч/з 1 месяц', withCheck: card.assessment.follow_up_timing === 'ч/з 1 месяц' },
        { pattern: 'ч/з 3 месяца', withCheck: card.assessment.follow_up_timing === 'ч/з 3 месяца' },
      ]);
    }

    // Save the template workbook (keeps only Медкарта-1 sheet, discards others)
    // Remove other sheets to keep only the one we need
    const sheetsToKeep = [sheetName];
    const sheetsToRemove = templateWorkbook.SheetNames.filter(name => !sheetsToKeep.includes(name));

    for (const sheetToRemove of sheetsToRemove) {
      delete templateWorkbook.Sheets[sheetToRemove];
    }

    templateWorkbook.SheetNames = sheetsToKeep;

    // Save file
    XLSX.writeFile(templateWorkbook, outputPath);
    console.log(`✅ Medical card exported to: ${outputPath}`);

    return outputPath;
  } catch (err) {
    console.error('❌ Error exporting to Excel:', err);
    throw err;
  }
}

/**
 * Generate filename for export
 */
export function generateExportFilename(card: MedicalCard): string {
  const name = card.demographics.full_name.replace(/\s+/g, '_');
  const date = card.created_at.split('T')[0];
  return `Medical_Card_${name}_${date}.xlsx`;
}
