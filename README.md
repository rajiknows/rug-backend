What’s This All About?
The RugCheck backend is the engine behind a token analysis platform. It’s designed to help users monitor tokens, set alerts for specific conditions (like price drops or liquidity changes), and eventually get real-time insights to avoid those nasty rug pulls. The goal is to make it the best alert system in the crypto ecosystem—because, let’s face it, there are way too many token analysis tools out there, but not enough that actually do something in real-time.
Right now, the backend is set up to:

Fetch token data from APIs like RugCheck and Fluxbeam.
Store that data in a database.
Let users create alerts based on token metrics.
Send email notifications when those alerts are triggered.

It’s a solid start, but there’s more to come—like insider movement alerts, liquidity monitoring, and even a browser extension to pre-screen transactions. But first, we need to iron out a few wrinkles.
The Architecture: How It All Fits Together
The backend is built using Cloudflare Workers, which is great for handling serverless functions at the edge. It’s fast, scalable, and perfect for a project like this. But here’s the thing: I originally planned to use Cloudflare’s own queue system for handling background tasks—like processing token data in batches or sending emails. However, after some trial and error, I decided to switch to Upstash queues instead.
Why Upstash?

Ease of Use: Upstash offers a Redis-based queue system that’s super straightforward to set up, especially with Cloudflare Workers.
Compatibility: It integrates seamlessly with the @upstash/redis client, which made it a no-brainer to switch.
Performance: Upstash is designed for serverless environments, so it handles the spiky workloads of a queue system without breaking a sweat.

So, all the queue-related tasks—like batching token updates or sending emails—are now handled by Upstash. It’s a small change, but it made the whole system feel more reliable.
On the database side, I’m using PostgreSQL with Prisma as the ORM. Prisma makes it easy to interact with the database, and it’s type-safe, which is a lifesaver when you’re dealing with complex queries. The database stores two main things:

Token Metrics: Historical data on token prices, liquidity, and other key metrics.
Alerts: User-defined conditions that trigger notifications when met.

The idea is to keep the architecture simple but scalable. Here’s a quick breakdown:

API Layer: Handles incoming requests (e.g., creating alerts, fetching token data).
Queue System: Manages background jobs like processing token batches or sending emails.
Database: Stores all the data we need for alerts and reporting.

It’s a classic setup, but it works—most of the time.
The Database Dilemma
Speaking of the database, that’s where things get a bit tricky. The database is set up to store token metrics and alerts, and Prisma is doing its job handling the queries. But when I deployed the backend to Cloudflare Workers, I ran into an issue: the routes that interact with the database aren’t working as expected.
For example:

When I try to create a new alert via POST /alert/new, it should save the alert to the database and return a success message. But instead, it’s failing silently.
Similarly, fetching alerts with GET /alert/get isn’t returning any data, even though I know there are records in the database.

I’ve double-checked the environment variables, and the DATABASE_URL is correctly set in the Cloudflare dashboard. I’m using Prisma Accelerate for connection pooling, which is supposed to handle the database connections efficiently in a serverless environment. But something’s still not clicking.
Here are a few things I suspect might be causing the issue:

Connection Limits: Maybe I’m hitting some limit on the number of database connections, and Prisma isn’t handling it properly.
Timeout Issues: Cloudflare Workers have strict timeouts, and perhaps the database queries are taking too long.
Misconfigured Credentials: Maybe there’s a typo in the database URL or credentials, but I’ve checked them multiple times.

If you’ve got any ideas or have run into similar issues, I’d love to hear your thoughts. You can check out the deployed backend at https://rugcheck-backend.rajeshhjhamain-dd8.workers.dev/—just don’t expect the database routes to work yet. 😅
Deployment: So Close, Yet So Far
The backend is live on Cloudflare Workers, and you can hit the API at the URL above. Most of the routes work fine—like the health check at / or the manual queue trigger at /internal/queue-jobs. But as I mentioned, anything that touches the database is currently broken.
I’m planning to dig deeper into the logs and maybe add some more debugging statements to figure out what’s going on. If you’re curious, feel free to poke around the code or suggest fixes. The repo is public, and I’m all for collaboration.
What’s Next?
Once I get the database issue sorted, the plan is to keep building out the alert system. Here are a few features I’m excited to add:

Insider Movement Alerts: Track suspicious wallet activity and notify users in real-time.
Liquidity Event Monitor: Watch for sudden changes in liquidity that might signal a rug pull.
Transaction Pre-Screening: Build a browser extension that checks transactions before they’re confirmed, warning users of potential risks.

These features will set the project apart from the usual token analysis tools, which mostly focus on static data. The goal is to make something that’s proactive and actually helps users avoid scams.
But first things first—I need to get those database routes working. If you’ve got any tips or want to help out, drop a comment or open a PR. Let’s make this the best alert system in crypto! 🚀
