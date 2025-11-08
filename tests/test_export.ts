import XLSX from 'xlsx';
import { createMedicalCard, updateChiefComplaint, updateMedicalHistory, addAssessment } from '../src/services/medical-card.js';
import { exportMedicalCardToExcel, generateExportFilename } from '../src/services/excel-export.js';
import * as fs from 'fs';
import * as path from 'path';

async function testMinimalExport() {
  console.log('🧪 MINIMAL EXPORT TEST\n');

  try {
    // Create card with sample data
    const demographics = {
      full_name: 'Тест Пациент',
      date_of_birth: '1990-05-15',
      sex: 'male' as const,
      marital_status: 'Не замужем',
      phone_number: '+7-777-123-4567',
      consent: true,
    };

    const card = createMedicalCard(123456, demographics);
    console.log('✅ Card created\n');

    // Add chief complaint with checkbox selections
    const chiefComplaint = {
      complaint: 'Острая боль в пояснице',
      symptom_onset: '2025-11-01',
      intensity: 7 as const,
      aggravating_factors: 'Наклоны',
      alleviating_factors: 'Отдых',
      condition_type: 'acute' as const,
      history_of_condition: 'Началось при поднятии тяжести',
      // Checkbox selections
      symptom_duration: 'более 2 недель' as const,
      pain_type: 'механическая' as const,
      pain_distribution: 'локализованная' as const,
      syndrome_type: 'ноцицептивная' as const,
    };

    updateChiefComplaint(card.card_id, chiefComplaint);
    console.log('✅ Chief complaint added\n');

    // Add medical history
    updateMedicalHistory(card.card_id, {
      similar_symptoms_before: true,
      previous_symptoms_details: 'Несколько раз в год',
      chronic_diseases: ['Остеохондроз'],
      current_medications: ['Ибупрофен'],
      allergies: [],
    });

    console.log('✅ Medical history added\n');

    // Add assessment with checkbox selections
    addAssessment(card.card_id, {
      preliminary_diagnosis: 'Люмбаго',
      red_flags: [],
      likely_causes: [{ name: 'Спазм мышц', rationale: 'Резкое движение' }],
      next_steps: ['Физиотерапия'],
      urgency: 'urgent care' as const,
      doctor_notes: 'Требуется обследование',
      date_of_assessment: new Date().toISOString().split('T')[0],
      // Checkbox selections
      severity: 'Выраженное' as const,
      changes: 'лучше' as const,
      discharge_status: 'есть эффект' as const,
      follow_up_timing: 'ч/з 1 месяц' as const,
    });

    console.log('✅ Assessment added\n');

    // Export
    const filename = generateExportFilename(card);
    const testDir = './test_export';

    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    const outputPath = path.join(testDir, filename);
    await exportMedicalCardToExcel(card, outputPath);
    console.log(`✅ Exported to: ${outputPath}\n`);

    // Verify
    console.log('📋 VERIFICATION:\n');

    const workbook = XLSX.readFile(outputPath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];

    const checks = [
      // Basic fields - now in merged cells with label+value
      { cell: 'A8', label: 'Date of filling', checkFor: '2025-11-03' },
      { cell: 'E8', label: 'Full Name', checkFor: 'Тест Пациент' },
      { cell: 'A10', label: 'Sex', checkFor: 'male' },
      { cell: 'E10', label: 'DOB', checkFor: '1990-05-15' },
      { cell: 'J10', label: 'Marital Status', checkFor: 'Не замужем' },
      { cell: 'A12', label: 'Phone', checkFor: '+7-777-123-4567' },
      { cell: 'A19', label: 'Chief Complaint', expected: chiefComplaint.complaint },
      { cell: 'A21', label: 'Aggravating & Alleviating Factors', checkFor: 'Наклоны' },
      { cell: 'B29', label: 'Medical History', expected: chiefComplaint.history_of_condition },
      { cell: 'B34', label: 'Syndrome', expected: chiefComplaint.complaint },
      { cell: 'H37', label: 'Allergies', expected: 'Нет' },
      { cell: 'B47', label: 'Main Diagnosis', expected: 'Люмбаго' },
      { cell: 'D47', label: 'Other Diagnoses', expected: 'Спазм мышц' },
      { cell: 'B76', label: 'Notes', expected: 'Требуется обследование' },
      // Checkbox cells - verify they contain checked boxes
      { cell: 'A30', label: 'Duration checkbox row', checkFor: '☑ более 2 недель' },
      { cell: 'H30', label: 'Condition type checkbox row', checkFor: '☑ спонтанная' },
      { cell: 'A32', label: 'Pain type checkbox row', checkFor: '☑ механическая' },
      { cell: 'H32', label: 'Pain distribution checkbox row', checkFor: '☑ локализованная' },
      { cell: 'C34', label: 'Syndrome type checkbox row', checkFor: '☑ ноцицептивная' },
      { cell: 'G50', label: 'Severity checkbox row (Выраженное)', checkFor: '☑' },
      { cell: 'H92', label: 'Changes checkbox row', checkFor: '☑ лучше' },
      { cell: 'H94', label: 'Discharge status checkbox row', checkFor: '☑ есть эффект' },
      { cell: 'H96', label: 'Follow-up timing checkbox row', checkFor: '☑ ч/з 1 месяц' },
    ];

    let passed = 0;
    let failed = 0;

    for (const check of checks) {
      const cellData = worksheet[check.cell];
      const actual = cellData ? String(cellData.v) : '';

      let isPass = false;

      if ('expected' in check) {
        // Exact match check
        isPass = actual === check.expected;
        if (isPass) {
          console.log(`✅ ${check.label} (${check.cell}): "${actual}"`);
          passed++;
        } else {
          console.log(`❌ ${check.label} (${check.cell})`);
          console.log(`   Expected: "${check.expected}"`);
          console.log(`   Actual: "${actual}"`);
          failed++;
        }
      } else if ('checkFor' in check) {
        // Substring/contains check
        isPass = actual.includes(check.checkFor);
        if (isPass) {
          console.log(`✅ ${check.label} (${check.cell}): contains "${check.checkFor}"`);
          passed++;
        } else {
          console.log(`❌ ${check.label} (${check.cell})`);
          console.log(`   Expected to include: "${check.checkFor}"`);
          console.log(`   Actual: "${actual}"`);
          failed++;
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`\n✅ Passed: ${passed}/${checks.length}`);
    console.log(`❌ Failed: ${failed}/${checks.length}`);
    console.log(`📁 File: ${outputPath}\n`);

    if (failed === 0) {
      console.log('🎉 ALL CHECKS PASSED!\n');
    } else {
      console.log('⚠️ Some checks failed\n');
      process.exit(1);
    }

  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

testMinimalExport();
