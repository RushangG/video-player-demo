export const DEMO_USERS = ["student-001", "student-002"];
const KEY = "SVP_CURRENT_USER";

export function getCurrentUserId(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && DEMO_USERS.includes(v)) return v;
  } catch (err) {
    console.error("get current user error : ", err);
  }
  return DEMO_USERS[0];
}

export function setCurrentUserId(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch (err) {
    console.error("set current user error : ", err);
  }
}
