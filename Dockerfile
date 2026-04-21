FROM oven/bun:1.3.12

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile

COPY src ./src
COPY test/fixtures ./test/fixtures

ENTRYPOINT ["bun", "run"]
CMD ["src/index.ts", "serve"]
