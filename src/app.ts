import "reflect-metadata";
import "./envConfig";
import { User } from "./entities/User";
import express from "express";
import cors from "cors";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import { globalEm } from "./dbconfig";
import session from "express-session";
import { TypeormStore } from "./TypeormStore";

const ghClientId = process.env.GITHUB_CLIENT_ID;
const ghClientSecret = process.env.GITHUB_CLIENT_SECRET;

if (!ghClientId || !ghClientSecret) {
  throw new Error("Missing GitHub OAuth credentials");
}

const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  throw new Error("Missing session secret");
}

function isAuthenticated(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (req.isAuthenticated()) {
    return next();
  }
  // if they aren't authenticated, send an error response
  res.status(401).json({ error: "Not authenticated" });
}

globalEm.then((em) => {
  passport.use(
    new GitHubStrategy(
      {
        clientID: ghClientId,
        clientSecret: ghClientSecret,
        callbackURL: "http://127.0.0.1:3000/auth/github/callback",
      },
      async (accessToken: any, refreshToken: any, profile: any, done: any) => {
        console.log("Profile: ", profile);
        const userRepo = em.getRepository(User);
        const existingUser = await userRepo.findOneBy({ githubId: profile.id });

        if (existingUser) {
          return done(null, existingUser);
        }

        const newUser = new User({
          githubId: profile.id,
          avatarUrl: profile.photos[0].value,
          name: profile.displayName,
          ghToken: accessToken,
          bio: profile._json.bio || "",
        });

        await userRepo.save(newUser);

        return done(null, newUser);
      }
    )
  );

  passport.serializeUser((user: any, cb) => {
    process.nextTick(() => {
      console.log("Serializing user", user);
      return cb(null, {
        id: user.id,
      });
    });
  });

  passport.deserializeUser((user: any, cb) => {
    process.nextTick(() => {
      console.log("Deserializing user", user);
      em.getRepository(User)
        .findOneBy({ id: user.id })
        .then((dbUser) => {
          return cb(null, dbUser);
        })
        .catch((err) => {
          return cb("Failed to deserialize user");
        });
    });
  });

  const app = express();
  app.use(passport.initialize());
  app.use(
    session({
      store: new TypeormStore(em),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 days // TODO: secure: true
    })
  );
  app.use(passport.authenticate("session"));
  
  app.use(cors());

  app.get("/", (req, res) => {
    const user = req.user as User | undefined;
    const link = user
      ? `<a href="/logout">Logout</a>`
      : `<a href="/auth/github">Login</a>`;
    res.send(`Hello ${user?.name || "there"} ${link}`);
  });

  app.get(
    "/auth/github",
    passport.authenticate("github", { scope: ["user:email", "read:user"] })
  );

  app.get(
    "/auth/github/callback",
    passport.authenticate("github", { failureRedirect: "/login" }),
    function (req, res) {
      console.log("Logged in, redirecting");
      // Successful authentication, redirect home.
      res.redirect("http://localhost:5173/");
    }
  );

  app.get(
    "/users/profile/:profileId",
    (req: express.Request<{ profileId?: string }>, res) => {
      const profileId = req.params.profileId;
      if (!profileId) {
        res.status(400).send({ error: "Missing profileId" });
        return;
      }
      console.log("Profile id: ", profileId);
      em.getRepository(User)
        .findOneBy({ id: profileId })
        .then((user) => {
          if (!user) {
            res.status(404).send({ error: "User not found" });
            return;
          }
          res.send({
            id: user.id,
            name: user.name,
            avatarUrl: user.avatarUrl,
          });
        });
    }
  );

  app.get("/users/me", isAuthenticated, (req, res) => {
    const user = req.user as User | undefined;
    res.send({
      name: user?.name,
      avatarUrl: user?.avatarUrl,
    });
  });

  app.get("/logout", (req, res, next) => {
    req.logout(function (err) {
      if (err) {
        return next(err);
      }
      res.redirect("/");
    });
  });

  app.listen(3000, () => {
    console.log("Listening on port 3000");
  });
});
