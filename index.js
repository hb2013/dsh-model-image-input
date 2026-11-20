/**
 * Host half of the model image-input bundle. The whole capability lives in
 * the Web client: it reads the llm-pi-ai settings namespace through the
 * settings Remote and writes model `input` modalities back through
 * `settings/mutate`, exactly like the official Models editor does, so the
 * Host half registers nothing of its own.
 */
export function apply() {}
