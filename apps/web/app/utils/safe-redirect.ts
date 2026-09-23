import * as v from 'valibot';

const localPathSchema = v.pipe(
  v.string(),
  v.check(
    (path) => path.startsWith('/') && !path.replaceAll('\\', '/').startsWith('//'),
    'Must be a local path',
  ),
);

export function redirectPathSchema(fallback: string) {
  return v.fallback(localPathSchema, fallback);
}
