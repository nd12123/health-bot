import XLSX from "xlsx";
import * as path from "path";

const filePath = path.join("..", "test_export", "Integration_Test_Export.xlsx");
console.log(`📋 READING EXPORTED FILE: ${filePath}\n`);

const workbook = XLSX.readFile(filePath);
const sheet = workbook.Sheets["Медкарта-1"];

if (!sheet) {
  console.error("❌ Sheet not found");
  process.exit(1);
}

console.log("🔍 CHECKBOX VERIFICATION:\n");

// Check key cells for checkbox marks
const checkboxCells = [
  { cell: "A30", desc: "Duration: более 4 месяцев" },
  { cell: "A32", desc: "Pain Type: постояннная" },
  { cell: "H32", desc: "Pain Distribution: локализованная" },
  { cell: "C34", desc: "Syndrome Type: нейропатическая" },
  { cell: "G50", desc: "Severity: Выраженное" },
  { cell: "H92", desc: "Changes: нейтрально" },
  { cell: "H94", desc: "Discharge: будет наблюдать" },
  { cell: "H96", desc: "Follow-up: ч/з 3 месяца" },
];

let passed = 0;
let failed = 0;

for (const { cell, desc } of checkboxCells) {
  const cellValue = sheet[cell];
  if (cellValue && cellValue.v && typeof cellValue.v === "string" && cellValue.v.includes("☑")) {
    console.log(`✅ ${desc}`);
    console.log(`   Cell ${cell}: ${cellValue.v}`);
    passed++;
  } else {
    console.log(`❌ ${desc}`);
    const val = cellValue && cellValue.v ? cellValue.v : "EMPTY";
    console.log(`   Cell ${cell}: ${val}`);
    failed++;
  }
}

console.log(`\n=====================================`);
console.log(`✅ Passed: ${passed}/${passed + failed}`);
console.log(`❌ Failed: ${failed}/${passed + failed}`);

if (failed === 0) {
  console.log("\n🎉 ALL CHECKBOXES PROPERLY MARKED IN EXCEL!");
} else {
  console.log(`\n⚠️ ${failed} checkbox(es) failed`);
}
