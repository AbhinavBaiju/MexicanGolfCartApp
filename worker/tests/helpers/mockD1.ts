type DbMethod = 'first' | 'all' | 'run';

export interface MockDbCall {
    sql: string;
    bindings: unknown[];
    method: DbMethod;
}

type RuleHandler<T> = T | ((call: MockDbCall) => T | Promise<T>);

export interface MockDbRule {
    match: string | RegExp;
    first?: RuleHandler<unknown>;
    all?: RuleHandler<{ results?: unknown[] }>;
    run?: RuleHandler<unknown>;
}

export interface MockDbOptions {
    rules: MockDbRule[];
    onBatch?: (statements: D1PreparedStatement[]) => Promise<unknown[]>;
}

export interface MockDbController {
    db: D1Database;
    calls: MockDbCall[];
}

export interface InspectablePreparedStatement extends D1PreparedStatement {
    __sql: string;
    __getBindings: () => unknown[];
}

function matchesRule(rule: MockDbRule, sql: string): boolean {
    if (typeof rule.match === 'string') {
        return sql.includes(rule.match);
    }
    return rule.match.test(sql);
}

async function resolveHandler<T>(handler: RuleHandler<T>, call: MockDbCall): Promise<T> {
    if (typeof handler === 'function') {
        const fn = handler as (arg: MockDbCall) => T | Promise<T>;
        return fn(call);
    }
    return handler;
}

export function createMockDbController(options: MockDbOptions): MockDbController {
    const calls: MockDbCall[] = [];

    const db: D1Database = {
        prepare(sql: string): D1PreparedStatement {
            let bindings: unknown[] = [];

            const statement: InspectablePreparedStatement = {
                __sql: sql,
                __getBindings: () => bindings,
                bind(...values: unknown[]): D1PreparedStatement {
                    bindings = values;
                    return statement;
                },
                async first(): Promise<unknown> {
                    const call: MockDbCall = { sql, bindings, method: 'first' };
                    calls.push(call);
                    const rule = options.rules.find((entry) => entry.first !== undefined && matchesRule(entry, sql));
                    if (!rule || rule.first === undefined) {
                        return null;
                    }
                    return resolveHandler(rule.first, call);
                },
                async all(): Promise<{ results?: unknown[] }> {
                    const call: MockDbCall = { sql, bindings, method: 'all' };
                    calls.push(call);
                    const rule = options.rules.find((entry) => entry.all !== undefined && matchesRule(entry, sql));
                    if (!rule || rule.all === undefined) {
                        return { results: [] };
                    }
                    return resolveHandler(rule.all, call);
                },
                async run(): Promise<unknown> {
                    const call: MockDbCall = { sql, bindings, method: 'run' };
                    calls.push(call);
                    const rule = options.rules.find((entry) => entry.run !== undefined && matchesRule(entry, sql));
                    if (!rule || rule.run === undefined) {
                        return { meta: { changes: 1 } };
                    }
                    return resolveHandler(rule.run, call);
                },
            } as D1PreparedStatement;

            return statement;
        },
        async batch(statements: D1PreparedStatement[]): Promise<unknown[]> {
            if (options.onBatch) {
                return options.onBatch(statements);
            }
            return [];
        },
        async exec(): Promise<{ count: number; duration: number }> {
            return { count: 0, duration: 0 };
        },
    } as D1Database;

    return { db, calls };
}
