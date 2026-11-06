import { compile } from '@earendil-works/pi-schema';

// Pi 1.5 coerces ordinary JSON Schema arguments. Our Python host intentionally
// uses strict Pydantic contracts, so reject invalid raw values before Pi can
// turn a numeric string into an integer, null into text, or a scalar into a list.
export function strictArguments(tool) {
  const validator = compile(tool.parameters, { unresolvedRefs: 'reject' });
  return args => {
    if (!validator.check(args)) {
      const errors = validator.errors(args).slice(0, 12).map(error => JSON.stringify(error)).join('\n');
      throw new Error(`Validation failed for tool "${tool.name}":\n${errors}\nReceived arguments:\n${JSON.stringify(args)}`);
    }
    return args;
  };
}
