import { invokeLogged } from "@/shared/api/invoke";
import type { TagDefinition } from "@typenotes/shared/tags";
export type TagRegistry = { version: 1; tags: TagDefinition[] };
export const readTagRegistry = (expectedRoot: string) => invokeLogged<TagRegistry>("read_tag_registry", { expectedRoot });
export const writeTagRegistry = (expectedRoot: string, registry: TagRegistry) => invokeLogged<void>("write_tag_registry", { expectedRoot, registry });
