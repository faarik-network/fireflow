# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
# Değerler runtime'da NUXT_PUBLIC_SUPABASE_* ile ezilir; build için yer tutucu yeterli.
ARG SUPABASE_URL=http://placeholder.invalid
ARG SUPABASE_KEY=placeholder
ENV SUPABASE_URL=$SUPABASE_URL SUPABASE_KEY=$SUPABASE_KEY
RUN npm run build

# ---- runtime ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build /app/.output ./.output
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["node", ".output/server/index.mjs"]
