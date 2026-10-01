# syntax=docker/dockerfile:1

# Multi-stage build for hosts that are not NixOS.
#   docker build -t subsonic-tui .
#   docker run --rm -p 8080:80 subsonic-tui
#
# The NixOS module is the first-class path (see README); this image exists for
# everything else.

FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM nginx:alpine AS runtime

# SPA + Subsonic streaming friendly config (immutable assets, no-cache shell).
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Runtime configuration hook: mount a config.js over this to pre-fill the
# server URL (never credentials).
RUN printf 'window.__SUBSONIC_TUI_CONFIG__ = window.__SUBSONIC_TUI_CONFIG__ || {};\n' \
      > /usr/share/nginx/html/config.js

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
