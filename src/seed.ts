import { ZenStackClient } from "@zenstackhq/orm";
import { SqliteDialect } from "@zenstackhq/orm/dialects/sqlite";
import SQLite from "better-sqlite3";
import bcrypt from "bcrypt";
import { schema } from "../zenstack/schema.js";

async function seed() {
  const db = new ZenStackClient(schema, {
    dialect: new SqliteDialect({
      database: new SQLite("./zenstack/dev.db"),
    }),
  });

  console.log("Seeding database...");

  // Cleanup existing data
  console.log("Cleaning up existing data...");
  await db.post.deleteMany({ where: {} });
  await db.user.deleteMany({ where: {} });


  // Hash password
  const hashedPassword = await bcrypt.hash("password123", 10);

  // Create 5 test users with realistic tech posts
  const usersData = [
    {
      email: "alice@zenstack.dev",
      posts: [
        { title: "Understanding Prisma and ZenStack", content: "Let's explore how ZenStack supercharges Prisma by adding access control, custom endpoints, and a bunch of great development tools right into your schema.", published: true },
        { title: "Advanced Access Control Patterns", content: "In this post, we dive deep into complex @@allow rules, multi-tenant architectures, and role-based access control.", published: true },
        { title: "Why Type Safety Matters in the API", content: "End-to-end type safety is no longer a luxury, it's a necessity for modern web teams. Here is how tRPC and ZenStack can help.", published: true },
        { title: "Draft: Migrating from REST to RPC", content: "A work-in-progress guide on moving away from traditional REST endpoints and embracing the RPC lifestyle.", published: false },
        { title: "Draft: Next.js 14 App Router Tips", content: "Gathering some thoughts on the new Next.js App Router and React Server Components.", published: false },
      ]
    },
    {
      email: "bob@zenstack.dev",
      posts: [
        { title: "Building Responsive Dashboards with Tailwind", content: "Tailwind CSS makes it incredibly easy to build complex, responsive layouts. Let's look at a few examples.", published: true },
        { title: "State Management in React 2024", content: "Zustand, Jotai, or Redux? Let's compare the state of the art in React state management.", published: true },
        { title: "React Server Components Explained", content: "Demystifying RSCs and how they impact your data fetching strategy. Hint: less JavaScript on the client!", published: true },
        { title: "Draft: Testing React Hooks", content: "Notes on using React Testing Library for custom hooks. Remember to wrap your state updates in act().", published: false },
        { title: "Draft: Framer Motion Animations", content: "Adding life to your UI with smooth spring animations. A brief tutorial.", published: false },
      ]
    },
    {
      email: "charlie@zenstack.dev",
      posts: [
        { title: "Setting up CI/CD for Fullstack Apps", content: "A comprehensive guide to GitHub Actions for your Next.js and Prisma stack. Catch bugs before they hit production.", published: true },
        { title: "Dockerizing Your Node.js Application", content: "Best practices for writing Dockerfiles for modern Node apps. Multi-stage builds are your friend.", published: true },
        { title: "PostgreSQL Performance Tuning", content: "Learn how to optimize your queries, understand EXPLAIN ANALYZE, and add the right indexes to your database.", published: true },
        { title: "Draft: Kubernetes for Beginners", content: "An introduction to pods, deployments, services, and ingress. It's not as scary as it sounds.", published: false },
        { title: "Draft: AWS CDK Best Practices", content: "Infrastructure as code is the future. Here's how to do it right with the AWS Cloud Development Kit.", published: false },
      ]
    },
    {
      email: "diana@zenstack.dev",
      posts: [
        { title: "Product Requirements for Modern Web Apps", content: "How to write PRDs that engineers actually want to read. Keep it concise, focus on the user.", published: true },
        { title: "Agile Development with ZenStack", content: "Speeding up the prototyping phase using declarative data models. Skip the boilerplate.", published: true },
        { title: "User Story Mapping Techniques", content: "Visualizing the user journey to build better features. Grab some sticky notes and let's get to work.", published: true },
        { title: "Draft: Q3 Roadmap Planning", content: "Internal notes for upcoming features in Q3. Focusing on enterprise SSO and audit logs.", published: false },
        { title: "Draft: Competitor Analysis", content: "A breakdown of the current BaaS landscape. Where do we sit compared to Supabase and Firebase?", published: false },
      ]
    },
    {
      email: "ethan@zenstack.dev",
      posts: [
        { title: "Securing Your API Endpoints", content: "Never trust the client. Always validate and authorize on the server. Here are 5 common mistakes.", published: true },
        { title: "Common Vulnerabilities in Node.js", content: "A look at the OWASP top 10 and how they apply to Node environments. Prototype pollution is real.", published: true },
        { title: "Implementing OAuth2 the Right Way", content: "A deep dive into authorization code flows, PKCE, and why implicit flow is dead.", published: true },
        { title: "Draft: Zero Trust Architecture", content: "Moving beyond perimeter security in modern cloud deployments. Trust nothing, verify everything.", published: false },
        { title: "Draft: JWT Security Considerations", content: "Why you shouldn't store JWTs in local storage, and the benefits of httpOnly cookies.", published: false },
      ]
    }
  ];

  for (const userData of usersData) {
    const user = await db.user.create({
      data: {
        email: userData.email,
        password: hashedPassword,
        posts: {
          create: userData.posts.map((post) => ({
            ...post,
            viewCount: Math.floor(Math.random() * 1000),
          })),
        },
      },
      include: { posts: true },
    });

    console.log(`Created user: ${user.email} (id: ${user.id}) with ${user.posts.length} posts`);
  }

  console.log("\nSeed complete! Use these credentials to log in:");
  console.log("  Emails:   alice@zenstack.dev, bob@zenstack.dev, etc.");
  console.log("  Password: password123");
}

seed().catch(console.error);
