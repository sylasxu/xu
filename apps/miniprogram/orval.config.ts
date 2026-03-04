import { defineConfig } from 'orval'

export default defineConfig({
  juchang: {
    input: {
      target: 'http://127.0.0.1:1996/openapi/json',
    },
    output: {
      mode: 'tags-split',
      target: 'src/api/endpoints',
      schemas: 'src/api/model',
      client: 'fetch',
      mock: false,
      clean: true,
      prettier: true,
      override: {
        mutator: {
          path: './src/utils/wx-request.ts',
          name: 'wxRequest',
        },
      },
    },
    hooks: {
      afterAllFilesWrite: 'prettier --write',
    },
  },
})
