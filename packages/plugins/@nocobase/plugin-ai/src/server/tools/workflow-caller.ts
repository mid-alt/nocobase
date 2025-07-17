/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { z } from 'zod';
import PluginWorkflowServer, { Processor, EXECUTION_STATUS } from '@nocobase/plugin-workflow';
import { Context } from '@nocobase/actions';
import { ToolRegisterOptions } from '../manager/tool-manager';

interface ParameterConfig {
  name: string;
  displayName?: string;
  description?: string;
  type: 'string' | 'number' | 'enum' | 'boolean';
  options?: Array<{ value: string | number; label: string }>;
  required?: boolean;
}

interface ToolConfig {
  name: string;
  description?: string;
  parameters?: ParameterConfig[];
}

interface Workflow {
  key: string;
  title: string;
  description?: string;
  config: ToolConfig;
}

const buildSchema = (config: ToolConfig): z.ZodObject<any> => {
  const schemaProperties: Record<string, z.ZodTypeAny> = {};
  if (config.parameters?.length) {
    config.parameters.forEach((item) => {
      let fieldSchema: z.ZodTypeAny;

      switch (item.type) {
        case 'string':
          fieldSchema = z.string();
          break;
        case 'number':
          fieldSchema = z.number();
          break;
        case 'boolean':
          fieldSchema = z.boolean();
          break;
        case 'enum':
          if (item.options && item.options.length > 0) {
            const enumValues = item.options.map((option) => option.value);
            if (typeof enumValues[0] === 'number') {
              const values = enumValues.map(String) as [string, ...string[]];
              fieldSchema = z.enum(values).transform((v) => Number(v));
            } else {
              fieldSchema = z.enum(enumValues as [string, ...string[]]);
            }
          } else {
            fieldSchema = z.string();
          }
          break;
        default:
          fieldSchema = z.any();
      }

      if (item.description) {
        fieldSchema = fieldSchema.describe(item.description);
      }
      if (!item.required) {
        fieldSchema = fieldSchema.optional();
      }
      schemaProperties[item.name] = fieldSchema;
    });
  }

  const schema = z.object(schemaProperties);
  return schema.describe(config.description || '');
};

const invoke = async (ctx: Context, workflow: Workflow, args: Record<string, any>) => {
  const workflowPlugin = ctx.app.pm.get('workflow') as PluginWorkflowServer;
  const processor = (await workflowPlugin.trigger(workflow as any, {
    ...args,
  })) as Processor;
  if (!processor.lastSavedJob) {
    return { status: 'error' as const, content: 'No content' };
  }
  if (processor.execution.status !== EXECUTION_STATUS.RESOLVED) {
    return { status: 'error' as const, content: 'Workflow execution exceptions' };
  }
  const lastJobResult = processor.lastSavedJob.result;
  return {
    status: 'success' as const,
    content: JSON.stringify(lastJobResult),
  };
};

export const getWorkflowCallers = async (plugin) => {
  const workflowPlugin = plugin.app.pm.get('workflow') as PluginWorkflowServer;
  const aiSupporterWorkflows = Array.from(workflowPlugin.enabledCache.values()).filter(
    (item) => item.type === 'ai-employee',
  );
  const register: ToolRegisterOptions[] = [];
  for (const workflow of aiSupporterWorkflows) {
    const config = workflow.config;
    register.push({
      tool: {
        name: workflow.key,
        title: workflow.title,
        description: workflow.description,
        schema: buildSchema(config),
        invoke: async (ctx: Context, args: Record<string, any>) => invoke(ctx, workflow, args),
      },
    });
  }
  return register;
};
