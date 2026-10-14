// Match only a complete classifier reply, never labels embedded in code or prose.
export const isClassificationOnly = text => typeof text === 'string'
    && /^\s*(?:(?:User|Response) Safety:\s*(?:safe|unsafe)\s*)+$/i.test(text);
