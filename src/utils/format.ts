// src/utils/format.ts
export function bullets(arr: string[]) {
  return arr && arr.length ? "• " + arr.join("\n• ") : "—";
}

export function formatUrgency(u: "self-care" | "gp" | "urgent care" | "emergency") {
  switch (u) {
    case "self-care":   return "🟢 Самопомощь";
    case "gp":          return "🟡 Связаться с врачом";
    case "urgent care": return "🟠 Неотложная помощь";
    case "emergency":   return "🔴 Срочно в скорую";
  }
}
