import "reflect-metadata";
import "./envConfig";
import { User } from "./entities/User";
import express from "express";
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

passport.use(
  new GitHubStrategy(
    {
      clientID: ghClientId,
      clientSecret: ghClientSecret,
      callbackURL: "http://127.0.0.1:3000/auth/github/callback",
    },
    async (accessToken: any, refreshToken: any, profile: any, done: any) => {
      console.log("Profile: ", profile);
      const em = await globalEm;
      const userRepo = em.getRepository(User);
      const existingUser = await userRepo.findOneBy({ githubId: profile.id });

      if (existingUser) {
        return done(null, existingUser);
      }

      const newUser = new User({
        githubId: profile.id,
        avatarUrl: profile.photos[0].value,
        name: profile.displayName,
      });

      await userRepo.save(newUser);

      return done(null, newUser);
    },
  ),
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
    globalEm.then((em) => {
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
});

const app = express();
app.use(passport.initialize());
app.use(
  session({
    store: new TypeormStore(),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 days // TODO: secure: true
  }),
);
app.use(passport.authenticate("session"));

app.get("/", (req: express.Request, res) => {
  const user = req.user as User | undefined;
  res.send(`Hello ${user?.name}`);
});

app.get(
  "/auth/github",
  passport.authenticate("github", { scope: ["user:email", "read:user"] }),
);

app.get(
  "/auth/github/callback",
  passport.authenticate("github", { failureRedirect: "/login" }),
  function (req, res) {
    console.log("Logged in, redirecting");
    // Successful authentication, redirect home.
    res.redirect("/");
  },
);

app.listen(3000, () => {
  console.log("Listening on port 3000");
});
