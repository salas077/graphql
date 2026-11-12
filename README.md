# GraphQL Profile

A personal profile page for Zone01 Athens. It signs in with your platform account, reads your data from the Zone01 GraphQL API and shows it with custom SVG charts.

**Live demo:** _coming soon_

## Features

- **Login** with `username:password` or `email:password`, with a clear error message for invalid credentials
- **Logout** that removes the JWT, so a page refresh does not log you back in
- **Three info sections**
  - User: login, full name, email, user ID, level
  - XP: total XP and the latest XP gains
  - Audits: audit ratio, audits done and received
- **Statistics section** with three SVG charts (no chart libraries)
  - XP over time (line chart)
  - XP by project, top 8 (bar chart)
  - Audits done vs received (donut chart)
- **Mini GraphiQL**: run any GraphQL query with your own token
- Hover tooltips on all charts, dark theme, responsive layout

## How it works

1. The login form sends `username:password` encoded in **base64** to
   `https://platform.zone01.gr/api/auth/signin` using **Basic** authentication.
2. The server returns a **JWT**, which is stored in `localStorage`.
3. Every GraphQL request is sent to
   `https://platform.zone01.gr/api/graphql-engine/v1/graphql`
   with the header `Authorization: Bearer <JWT>`.
4. The data is used to fill the sections and draw the SVG charts with
   `document.createElementNS`.

## GraphQL queries

All three required query types are used (see `app.js`, section 2):

| Type | Example in the project |
|---|---|
| Normal | `user { id login attrs auditRatio totalUp totalDown }` |
| With arguments | `transaction(where: { type: { _eq: $type } }, order_by: { createdAt: asc })` |
| Nested | `transaction { amount object { name type } }` |

## Run locally

```bash
git clone https://platform.zone01.gr/git/gsalaoun/graphql.git
cd graphql
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Project structure

```
graphql/
├── index.html   # login form and profile layout
├── style.css    # dark theme styles
├── app.js       # login, GraphQL queries, SVG charts
└── README.md
```

## Technologies

HTML, CSS, JavaScript (no frameworks), GraphQL, JWT, SVG

## Author

[gsalaoun](https://platform.zone01.gr/git/gsalaoun)