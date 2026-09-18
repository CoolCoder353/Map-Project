import type { TestInstance } from 'test-renderer';
import type { WaitForOptions } from '../wait-for';
export type GetByQuery<Predicate, Options = void> = (predicate: Predicate, options?: Options) => TestInstance;
export type GetAllByQuery<Predicate, Options = void> = (predicate: Predicate, options?: Options) => TestInstance[];
export type QueryByQuery<Predicate, Options = void> = (predicate: Predicate, options?: Options) => TestInstance | null;
export type QueryAllByQuery<Predicate, Options = void> = (predicate: Predicate, options?: Options) => TestInstance[];
export type FindByQuery<Predicate, Options = void> = (predicate: Predicate, options?: Options & WaitForOptions, waitForOptions?: WaitForOptions) => Promise<TestInstance>;
export type FindAllByQuery<Predicate, Options = void> = (predicate: Predicate, options?: Options & WaitForOptions, waitForOptions?: WaitForOptions) => Promise<TestInstance[]>;
type UnboundQuery<Query> = (instance: TestInstance) => Query;
export type UnboundQueries<Predicate, Options> = {
    getBy: UnboundQuery<GetByQuery<Predicate, Options>>;
    getAllBy: UnboundQuery<GetAllByQuery<Predicate, Options>>;
    queryBy: UnboundQuery<QueryByQuery<Predicate, Options>>;
    queryAllBy: UnboundQuery<QueryAllByQuery<Predicate, Options>>;
    findBy: UnboundQuery<FindByQuery<Predicate, Options>>;
    findAllBy: UnboundQuery<FindAllByQuery<Predicate, Options>>;
};
export declare function makeQueries<Predicate, Options>(queryAllByQuery: UnboundQuery<QueryAllByQuery<Predicate, Options>>, getMissingError: (predicate: Predicate, options?: Options) => string, getMultipleError: (predicate: Predicate, options?: Options) => string): UnboundQueries<Predicate, Options>;
export {};
