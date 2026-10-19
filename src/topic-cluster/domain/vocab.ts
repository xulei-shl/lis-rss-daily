/**
 * 切面词表（研究方法 / 研究对象）——**单一事实来源**。
 *
 * 为什么需要封闭词表（首轮 30 篇实测结论）：
 *   方法×对象矩阵与「研究空白」推导要求**同一概念只对应一个键**。
 *   自由文本下「文献分析 / 文献综述 / 文献研究」各是一个键，
 *   矩阵里同一格被拆成三格，空缺格的判定随之失真。
 *   实测：研究对象键 52 个 / 提及 52 次 —— 完全没有重复键，矩阵对象轴全空。
 *
 * 两个用途共用同一份定义，避免提示词与代码各维护一套而漂移：
 *   1. 注入提示词（`{{METHOD_VOCAB}}` / `{{OBJECT_VOCAB}}`）约束模型输出；
 *   2. 读取时归一（`normalizeMethodKeys` / `normalizeObjectKeys`），
 *      兼容历史切面与模型偶发的词表外表述。
 *
 * 归一规则精确且可复核，不做模糊/相似度匹配：
 *   命中词表或别名 → 规范键；否则**不产生键**
 *   （原文仍保留在 `facet_json` 里，页面照常展示，只是不参与矩阵与熵的聚合）。
 *   被剔除的表述由 `listOffVocabularyTerms` 汇总告警 —— 那是补充词表/别名的信号。
 *
 * 本文件为纯函数模块，不 import 数据库、日志或 LLM。
 */

import { splitKeys, type FacetFields } from './facet.js';

export type FacetKeyKind = 'method' | 'object';

/** 规范研究方法（提示词词表 + 归一词表） */
export const FACET_METHODS = [
  '文献研究',
  '文献计量',
  '系统综述',
  '内容分析',
  '案例研究',
  '问卷调查',
  '访谈',
  '实地调研',
  '实验研究',
  '眼动实验',
  '脑电实验',
  '扎根理论',
  '理论分析',
  '德尔菲法',
  '框架构建',
  '比较研究',
  '历史分析',
  '机器学习建模',
  '结构方程模型',
  '定性比较分析',
  '统计分析',
  '二手数据分析',
] as const;

/** 规范研究对象（提示词词表 + 归一词表） */
export const FACET_OBJECTS = [
  // 数据驱动补充：实测 230 篇里有 6 篇以「图书馆」为研究对象（发展历程 / AI 应用 / 多馆案例），
  // 模型确实需要一个“泛指图书馆”的类别。风险是它可能变成惰性默认值，
  // 由词表外告警与矩阵占比监控（若占比异常升高即需要拆细）。
  '图书馆',
  '高校图书馆',
  '公共图书馆',
  '专业图书馆',
  '图书馆联盟',
  '高校学生',
  '高校教师',
  '科研人员',
  '图书馆员',
  '公共图书馆用户',
  '高校图书馆用户',
  '社会公众',
  '老年用户',
  '青少年与儿童',
  '数字资源平台',
  '学术文献',
  '特藏与古籍',
  '档案资源',
  '政策文本',
  '图书馆业务数据',
  '智能服务系统',
  '大语言模型',
] as const;

/** 方法同义词 → 规范词（键统一小写，与 splitKeys 的输出对齐） */
const METHOD_ALIAS_TABLE: Record<string, string> = {
  文献综述: '文献研究',
  文献分析: '文献研究',
  文献调研: '文献研究',
  文献研究法: '文献研究',
  文献回顾: '文献研究',
  文献计量法: '文献计量',
  文献计量分析: '文献计量',
  内容分析法: '内容分析',
  案例分析: '案例研究',
  案例分析法: '案例研究',
  案例调查: '案例研究',
  网络调研: '问卷调查',
  网络调研法: '问卷调查',
  网络调查: '问卷调查',
  网络调查法: '问卷调查',
  问卷调研: '问卷调查',
  问卷调查法: '问卷调查',
  政策文本分析: '内容分析',
  访谈法: '访谈',
  深度访谈: '访谈',
  半结构化访谈: '访谈',
  参与式观察: '实地调研',
  实地调查: '实地调研',
  田野调查: '实地调研',
  理论探讨: '理论分析',
  理论推演: '理论分析',
  逻辑推演: '理论分析',
  理论综述: '理论分析',
  德尔菲: '德尔菲法',
  德尔菲专家咨询法: '德尔菲法',
  概念框架构建: '框架构建',
  模型构建: '框架构建',
  体系构建: '框架构建',
  架构设计: '框架构建',
  系统架构设计与部署: '框架构建',
  实验法: '实验研究',
  准实验研究: '实验研究',
  情境实验: '实验研究',
  因子分析: '统计分析',
  差异分析: '统计分析',
  描述性统计: '统计分析',
  机器学习: '机器学习建模',
  深度学习: '机器学习建模',
  数据挖掘: '机器学习建模',
  文本挖掘: '机器学习建模',
  主题模型: '机器学习建模',
  lda主题模型: '机器学习建模',
  '结构方程模型(pls-sem)': '结构方程模型',
  'pls-sem': '结构方程模型',
  '模糊集定性比较分析（fsqca）': '定性比较分析',
  '模糊集定性比较分析(fsqca)': '定性比较分析',
  模糊集定性比较分析: '定性比较分析',
  fsqca: '定性比较分析',
  qca: '定性比较分析',
  历史分析法: '历史分析',
  历史研究: '历史分析',
  比较分析: '比较研究',
  对比分析: '比较研究',
};

/** 研究对象同义词 → 规范词（键统一小写） */
const OBJECT_ALIAS_TABLE: Record<string, string> = {
  大学生: '高校学生',
  高校大学生: '高校学生',
  大学生用户: '高校学生',
  本硕学生: '高校学生',
  本科生: '高校学生',
  研究生: '高校学生',
  高校读者: '高校学生',
  教师: '高校教师',
  馆员: '图书馆员',
  图书馆工作人员: '图书馆员',
  从业者: '图书馆员',
  读者: '公共图书馆用户',
  图书馆用户: '公共图书馆用户',
  公共图书馆读者: '公共图书馆用户',
  老年人: '老年用户',
  老年读者: '老年用户',
  老年群体: '老年用户',
  少年儿童: '青少年与儿童',
  未成年人: '青少年与儿童',
  中小学生: '青少年与儿童',
  公众: '社会公众',
  社会大众: '社会公众',
  数字资源: '数字资源平台',
  数据库: '数字资源平台',
  学术论文: '学术文献',
  期刊论文: '学术文献',
  相关文献: '学术文献',
  古籍: '特藏与古籍',
  古籍文献: '特藏与古籍',
  特藏资源: '特藏与古籍',
  数字档案: '档案资源',
  档案馆藏: '档案资源',
  政策文件: '政策文本',
  政策工具: '政策文本',
  战略规划: '政策文本',
  规划文本: '政策文本',
  借阅数据: '图书馆业务数据',
  读者数据: '图书馆业务数据',
  用户反馈文本: '图书馆业务数据',
  智能体: '智能服务系统',
  荐书平台: '智能服务系统',
  问答系统: '智能服务系统',
  智能服务平台: '智能服务系统',
  生成式人工智能: '大语言模型',
  生成式ai: '大语言模型',
  genai: '大语言模型',
  ai大模型: '大语言模型',
  llm: '大语言模型',
  chatgpt: '大语言模型',
  deepseek: '大语言模型',
};

/** 注入提示词用的词表文本（与归一词表同源） */
export const METHOD_VOCAB_TEXT = FACET_METHODS.join(' / ');
export const OBJECT_VOCAB_TEXT = FACET_OBJECTS.join(' / ');

const METHOD_CANONICAL = buildCanonicalMap(FACET_METHODS);
const OBJECT_CANONICAL = buildCanonicalMap(FACET_OBJECTS);
const METHOD_ALIASES = buildCanonicalMap(Object.entries(METHOD_ALIAS_TABLE));
const OBJECT_ALIASES = buildCanonicalMap(Object.entries(OBJECT_ALIAS_TABLE));

interface NormalizedField {
  keys: string[];
  /** 未命中词表的原始表述（保序、去重） */
  offVocabulary: string[];
}

/** 方法字段 → 规范方法键 */
export function normalizeMethodKeys(raw: string | null | undefined): string[] {
  return normalizeField(raw, 'method').keys;
}

/**
 * 研究对象字段 → 规范对象键。
 *
 * 规范写法是「通用类别（具体样本）」，因此**先剥掉括号内容再匹配类别**：
 * 括号里是样本量、地区、平台等细节，属于个案信息，不该进入矩阵轴。
 */
export function normalizeObjectKeys(raw: string | null | undefined): string[] {
  return normalizeField(raw, 'object').keys;
}

export interface OffVocabularyReport {
  /** 出现词表外表述的文章数 */
  articleCount: number;
  /** 词表外表述（按出现次数降序） */
  terms: { term: string; kind: FacetKeyKind; count: number }[];
}

/**
 * 汇总一批切面的词表外表述。
 *
 * 抽取环节用它做**一次**批量告警（而不是逐篇打日志）：
 * 词表外表述稳定出现 = 提示词词表需要扩充，是提示词漂移的最早信号。
 */
export function listOffVocabularyTerms(facets: FacetFields[]): OffVocabularyReport {
  const counter = new Map<string, { term: string; kind: FacetKeyKind; count: number }>();
  let articleCount = 0;

  for (const facet of facets) {
    const off = [
      ...normalizeField(facet.method, 'method').offVocabulary.map((term) => ({ term, kind: 'method' as const })),
      ...normalizeField(facet.study_object, 'object').offVocabulary.map((term) => ({ term, kind: 'object' as const })),
    ];
    if (off.length === 0) continue;
    articleCount += 1;
    for (const item of off) {
      const key = `${item.kind}\u0000${item.term}`;
      const existing = counter.get(key);
      if (existing) existing.count += 1;
      else counter.set(key, { ...item, count: 1 });
    }
  }

  return {
    articleCount,
    terms: [...counter.values()].sort((a, b) => b.count - a.count || a.term.localeCompare(b.term)),
  };
}

/* ── 内部实现 ── */

function normalizeField(raw: string | null | undefined, kind: FacetKeyKind): NormalizedField {
  if (!raw) return { keys: [], offVocabulary: [] };

  const candidates = splitCandidates(raw, kind);
  const canonical = kind === 'method' ? METHOD_CANONICAL : OBJECT_CANONICAL;
  const aliases = kind === 'method' ? METHOD_ALIASES : OBJECT_ALIASES;

  const keys: string[] = [];
  const offVocabulary: string[] = [];

  for (const candidate of candidates) {
    const matched = canonical.get(candidate) ?? aliases.get(candidate);
    if (matched) {
      if (!keys.includes(matched)) keys.push(matched);
    } else if (!offVocabulary.includes(candidate)) {
      offVocabulary.push(candidate);
    }
  }

  return { keys, offVocabulary };
}

function splitCandidates(raw: string, kind: FacetKeyKind): string[] {
  return kind === 'method' ? splitKeys(raw) : splitKeys(stripBrackets(raw));
}

/**
 * 剥掉「通用类别」后面的括号细节，只留类别。
 *
 * 用深度扫描而不是正则：实测出现过**嵌套括号**的合法写法
 * 「公共图书馆（湖南省少年儿童图书馆和湘江新区（岳麓）图书馆）」——
 * 正则 `（[^）]*）` 会停在第一个内层右括号，剩下「图书馆）」粘成词表外碎片，
 * 导致该篇整条对象轴丢失。
 *
 * 不配对的右括号只去符号并断开粘连，避免把内容与后面的类别粘成一个键。
 */
function stripBrackets(value: string): string {
  let depth = 0;
  let out = '';

  for (const char of value) {
    if (char === '（' || char === '(') {
      depth += 1;
      if (depth === 1) out += ' ';
      continue;
    }
    if (char === '）' || char === ')') {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      out += '、';
      continue;
    }
    if (depth === 0) out += char;
  }

  return out;
}

/** 规范词与别名统一 lowercase，与 splitKeys 的输出对齐 */
function buildCanonicalMap(entries: readonly (string | [string, string])[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (typeof entry === 'string') map.set(entry.toLowerCase(), entry);
    else map.set(entry[0].toLowerCase(), entry[1]);
  }
  return map;
}
