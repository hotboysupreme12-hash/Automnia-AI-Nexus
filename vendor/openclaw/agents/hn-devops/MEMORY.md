# MEMORY.md — Marcus Thorne (hn-devops)

*Last updated: 2026-05-07*

## Project: Jeopardy 10X
**Repo:** `/home/supreme/Downloads/openclaw-control-center/jeopardy-10x/`
**Blueprint:** `jeopardy -trial.html` (vanilla JS single-file source)
**Target:** React 18 + TypeScript + Vite production app

### Infrastructure Stack
- **Build:** Vite 6 with esbuild minification, CSS minify, vendor chunk splitting
- **Deploy Targets:** Docker Compose, GitHub Pages, Netlify, Vercel, Cloudflare Pages, AWS S3+CloudFront, VPS
- **CI/CD:** GitHub Actions — lint → typecheck → test (coverage) → build (bundle audit) → docker (smoke test)
- **Container:** Multi-stage Dockerfile (node:22-alpine build → nginx:alpine prod), dev Dockerfile
- **nginx:** Security headers, gzip, SPA fallback, health endpoint, cache control
- **Bundle Size:** ~63KB gzipped total — well under 200KB budget

### Key People
- **Commander:** James Roberts (hn-builder) — slot 1, owns final integration
- **Design:** Olivia Chen (hn-ux)
- **Components:** Priya Sharma (hn-fullstack)
- **Testing:** Yuki Tanaka (hn-testing)
- **Architecture:** Elena Vasquez (hn-architect)

### Known Issues
- Lint warnings (7 total, all acceptable — missing deps, alert/confirm/prompt usage, fast-refresh export)
- No rush to fix unless they become errors
