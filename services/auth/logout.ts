import { repositories } from "../../data/repositories";
import { recordAuthEvent, type ClientInfo } from "./journal";
import { getMutableIronSession } from "./session";

export async function logout(client?: ClientInfo): Promise<void> {
  const session = await getMutableIronSession();
  const user = session.userId ? await repositories.users.findById(session.userId) : null;
  session.destroy();
  if (user) await recordAuthEvent({ email: user.email, userId: user.id, outcome: "DECONNEXION", client });
}
