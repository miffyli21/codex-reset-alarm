export function isWakeWindowInChina(date: Date): boolean {
  const hourText = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
  const hour = Number(hourText);
  return hour >= 23 || hour < 16;
}
