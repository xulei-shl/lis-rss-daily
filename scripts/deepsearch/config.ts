import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { DeepSearchConfig } from './types.js';

const DEFAULT_CONFIG_PATH = path.join(__dirname, 'config', 'config.yaml');

let configInstance: DeepSearchConfig | null = null;

export function loadConfig(configPath?: string): DeepSearchConfig {
  if (configInstance && !configPath) {
    return configInstance;
  }

  const effectivePath = configPath || DEFAULT_CONFIG_PATH;

  if (!fs.existsSync(effectivePath)) {
    throw new Error(`配置文件不存在: ${effectivePath}`);
  }

  const fileContents = fs.readFileSync(effectivePath, 'utf8');
  const config = yaml.load(fileContents) as DeepSearchConfig;

  if (!config.user?.userId) {
    throw new Error('配置文件中缺少 user.userId');
  }

  if (!config.database?.path) {
    throw new Error('配置文件中缺少 database.path');
  }

  configInstance = config;
  return config;
}

export function getConfig(): DeepSearchConfig {
  if (!configInstance) {
    return loadConfig();
  }
  return configInstance;
}

export function reloadConfig(configPath?: string): DeepSearchConfig {
  configInstance = null;
  return loadConfig(configPath);
}