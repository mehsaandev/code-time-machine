/**
 * Type definitions for sql.js
 * Pure JavaScript SQLite implementation
 */
declare module 'sql.js' {
    export interface SqlJsStatic {
        Database: DatabaseConstructor;
    }

    export interface DatabaseConstructor {
        new (): Database;
        new (data?: ArrayLike<number> | Buffer | null): Database;
    }

    export interface Database {
        run(sql: string, params?: BindParams): void;
        exec(sql: string, params?: BindParams): QueryExecResult[];
        each(
            sql: string,
            params: BindParams,
            callback: (row: ParamsObject) => void,
            done: () => void
        ): void;
        each(
            sql: string,
            callback: (row: ParamsObject) => void,
            done: () => void
        ): void;
        prepare(sql: string): Statement;
        export(): Uint8Array;
        close(): void;
        getRowsModified(): number;
        create_function(name: string, func: (...args: unknown[]) => unknown): void;
    }

    export interface Statement {
        bind(params?: BindParams): boolean;
        step(): boolean;
        getAsObject(params?: BindParams): ParamsObject;
        get(params?: BindParams): SqlValue[];
        getColumnNames(): string[];
        run(params?: BindParams): void;
        reset(): void;
        free(): boolean;
    }

    export type BindParams = SqlValue[] | ParamsObject | null;
    export type SqlValue = number | string | Uint8Array | null;
    export type ParamsObject = Record<string, SqlValue>;

    export interface QueryExecResult {
        columns: string[];
        values: SqlValue[][];
    }

    export interface SqlJsConfig {
        locateFile?: (filename: string) => string;
    }

    export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}
