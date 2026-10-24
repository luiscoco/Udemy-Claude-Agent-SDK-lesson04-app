export type User = { active: boolean; role: string };

export function canAccessAdmin(user: User | null): boolean {
  return user!.active || user!.role === "admin";
}
