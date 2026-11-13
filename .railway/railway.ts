// The card room on Railway, as Infrastructure as Code. Keep it in its own Railway project:
// `railway config apply` makes the project match this file.
//
//   railway link            # pick the spades project
//   railway config plan     # see what would change
//   railway config apply
//
// Then generate a domain for the service under Networking; generated domains aren't in this file.
import { defineRailway, github, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  // Tables and their move logs, in SQLite. A volume survives redeploys.
  const data = volume("spades-data", { sizeMB: 1024 });

  const spades = service("spades", {
    // Railway builds the Dockerfile at the repository root.
    source: github("mnichols08/spades", { branch: "main" }),
    healthcheck: "/healthz",
    // One process holds the live connections and every game's state: never more than one.
    replicas: 1,
    env: { SPADES_DB: "/data/spades.db" },
    volumeMounts: { "/data": data },
  });

  return project("spades", { resources: [data, spades] });
});
