import "reflect-metadata";
import "./envConfig";
import { User } from "./entities/User";
import express from "express";
import cors from "cors";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import { globalEm } from "./dbconfig";
import session from "express-session";
import { Octokit } from "octokit";
import pg from "pg";
import connectPg from "connect-pg-simple";
import path from "path";
import { simplifiedRepos } from "./utils";
import { promptGpt } from "./gpt";

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
        callbackURL: "http://127.0.0.1:3000/api/auth/github/callback",
      },
      async (accessToken: any, refreshToken: any, profile: any, done: any) => {
        console.log("Profile: ", profile);
        const userRepo = em.getRepository(User);
        const existingUser = await userRepo.findOneBy({ githubId: profile.id });

        if (existingUser) {
          existingUser.ghToken = accessToken;
          await userRepo.save(existingUser);
          return done(null, existingUser);
        }

        const newUser = new User({
          githubId: profile.id,
          avatarUrl: profile.photos[0].value,
          name: profile.displayName,
          ghToken: accessToken,
          ghUsername: profile.username,
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

  const pgSession = connectPg(session);
  const pgPool = new pg.Pool({
    host: "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASS || "postgres",
    database: process.env.DB_NAME || "postgres",
  });
  const app = express();
  app.use(
    session({
      store: new pgSession({
        pool: pgPool,
        tableName: "session",
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        // secure: false,
        httpOnly: true,
      }, // 30 days // TODO: secure: true
    })
  );
  app.use(passport.initialize());
  app.use(passport.session());

  app.use(cors());

  // Serve static react app
  app.use(express.static(path.join(__dirname, "../public")));

  app.get(
    "/auth/github",
    passport.authenticate("github", { scope: ["user:email", "read:user"] })
  );

  app.get(
    "/api/auth/github/callback",
    passport.authenticate("github", { failureRedirect: "/login" }),
    function (req, res) {
      const user = req.user as User | undefined;
      console.log(`Logged in as ${user?.ghUsername}, redirecting`);
      // Successful authentication, redirect home.
      // Set the session cookie
      req.session.save(() => {
        console.log("Session saved");
        // Add random cookie
        res.cookie("test", "test", { maxAge: 900000, httpOnly: true });
        res.redirect("/");
      });
    }
  );

  app.get(
    "/users/profile/:profileId",
    isAuthenticated,
    (req: express.Request<{ profileId?: string }>, res) => {
      const loggedUser = req.user as User;
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
          const octokit = new Octokit({
            auth: user.ghToken,
          });
          console.log("Username: ", user.ghUsername);
          octokit.rest.repos
            .listForUser({
              username: loggedUser.ghUsername,
            })
            .then((repos) => {
              console.log("Repos count: ", repos.data.length);
              res.send({
                id: user.id,
                name: user.name,
                avatarUrl: user.avatarUrl,
                reposCount: repos.data.length,
                repos: simplifiedRepos(repos.data),
              });
            });
        });
    }
  );

  app.get("/users/me", isAuthenticated, (req, res) => {
    const user = req.user as User;
    const octokit = new Octokit({
      auth: user.ghToken,
    });
    octokit.rest.repos
      .listForUser({
        username: user.ghUsername,
      })
      .then((repos) => {
        console.log("Repos count", repos.data.length);
        res.send({
          name: user?.name,
          avatarUrl: user?.avatarUrl,
          reposCount: repos.data.length,
          repos: simplifiedRepos(repos.data),
        });
      });
  });

  async function getRepoQuizQuestions(user: User, repoId: string) {
    const octokit = new Octokit({
      auth: user.ghToken,
    });
    const repoBranches = await octokit.rest.repos.listBranches({
      owner: user.ghUsername,
      repo: repoId,
    });
    if (!repoBranches.data.length) {
      throw new Error("Cannot get branches data");
    }
    const latestSha = repoBranches.data[0].commit.sha;
    const repoTree = await octokit.rest.git.getTree({
      owner: user.ghUsername,
      repo: repoId,
      tree_sha: latestSha,
      recursive: "true",
    });
    if (!repoTree.data.tree.length) {
      throw new Error("Cannot get tree data");
    }
    let repoJson = {};
    const filesContent = await Promise.all(
      repoTree.data.tree
        .filter((treeItem) => {
          return (
            treeItem.type === "blob" &&
            treeItem.path?.endsWith(".js") &&
            treeItem.url
          );
        })
        .map(async ({ url }) => {
          // Download file content
          const fileContent = await octokit.request(url as any);
          // Parse file content
          const conentDecoded = Buffer.from(
            fileContent.data.content,
            "base64"
          ).toString();
          return conentDecoded;
        })
    );
    console.log("JS files contents", filesContent);
    return ["Some mock question"];
  }

  app.get("/quiz-questions/:repoId", isAuthenticated, (req, res) => {
    const user = req.user as User;
    const repoId = req.params.repoId;
    getRepoQuizQuestions(user, repoId)
      .then((questions) => {
        return res.json(questions);
      })
      .catch((err) => {
        res.status(500).send({ error: err.message });
      });
  });

  app.post("/prompt-gpt", (req, res) => {
    const prompt = req.body.prompt;
    if (!prompt) {
      res.status(400).send({ error: "Missing prompt" });
      return;
    }
    promptGpt(prompt)
      .then((response) => {
        res.send({ response });
      })
      .catch((err) => {
        res.status(500).send({ error: err.message });
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
