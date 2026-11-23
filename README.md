# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Deployment

The site is served by GitHub Pages at `/Website/` from the `gh-pages` branch
(Settings → Pages → Source: "Deploy from a branch").

`.github/workflows/deploy.yml` runs on every push to `main` (and can be started
by hand from the Actions tab). It runs `npm ci` and `npm run build`, then
commits the contents of `dist/` to `gh-pages`. GitHub Pages then publishes that
commit in its own "pages build and deployment" run, usually a minute or two
later. Nothing has to be built or pushed by hand, and a change is live only
once both runs are green.

Everything in `public/` is copied into the build, so the Money Tracker in
`public/money/` is served at `/Website/money/`.

### Build-time configuration (optional)

The build reads these values if they exist as repository variables or secrets
(Settings → Secrets and variables → Actions). Without them the site builds in
demo mode with sign-in disabled, which is how it has been deployed so far.

| Name | Used for |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `VITE_STRIPE_PAYMENT_LINK` | Stripe Payment Link for the subscription |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |

All of them end up in the public JavaScript bundle, so only use values that are
safe to expose to browsers: never the Supabase `service_role` key or a Stripe
secret key. For local development put them in `.env.local` (see `.env.example`).
