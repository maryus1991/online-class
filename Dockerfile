# مرحلهٔ ساخت: نصب وابستگی‌ها (mediasoup باینری worker را دانلود/کامپایل می‌کند) و بسته‌بندی فایل‌های مرورگر
FROM oven/bun:1 AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/bun.lock* ./
RUN bun install
COPY server/ ./
COPY client/ /app/client/
RUN bun run build:client

# مرحلهٔ اجرا
FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server /app/server
COPY --from=build /app/client /app/client
WORKDIR /app/server
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "run", "src/index.ts"]
