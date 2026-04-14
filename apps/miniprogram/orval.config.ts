import { defineConfig } from 'orval'

export default defineConfig({
  xu: {
    input: {
      target: '.openapi/openapi.json',
      parserOptions: {
        validate: false,
      },
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
      afterAllFilesWrite: './node_modules/.bin/prettier --write',
    },
  },
})
