import { Store } from "express-session";
import { DataSource } from "typeorm";
import { Session as DbSession } from "./entities/Session";
import { User } from "./entities/User";
import { globalEm } from "./dbconfig";

export class TypeormStore extends Store {
  async get(
    sid: string,
    callback: (err: any, session?: any) => void,
  ): Promise<void> {
    const em = await globalEm;
    const sessionRepository = em.getRepository(DbSession);
    const dbSession = await sessionRepository.findOne({
      where: { sid },
    });
    if (dbSession) {
      callback(null, JSON.parse(dbSession.sess));
    } else {
      callback(null, undefined);
    }
  }

  async set(
    sid: string,
    session: any,
    callback?: (err?: any) => void,
  ): Promise<void> {
    console.log(`Setting session: ${session}`);
    const em = await globalEm;
    const sessionRepository = em.getRepository(DbSession);
    await sessionRepository.save({
      sid,
      sess: JSON.stringify(session),
      expire: new Date(session.cookie.expires),
    });
    if (callback) callback(null);
  }

  async destroy(sid: string, callback?: (err?: any) => void): Promise<void> {
    const em = await globalEm;
    const sessionRepository = em.getRepository(DbSession);
    await sessionRepository.delete({ sid });
    if (callback) callback(null);
  }
}
