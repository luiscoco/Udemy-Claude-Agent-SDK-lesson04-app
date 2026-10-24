export function canAccessAdmin(user: { active: boolean; role: string } | null): boolean {
  return Boolean(user && user.active && user.role === "admin");
}
