import { useEffect, type RefObject } from 'react';
import type { PatientLanguage } from '../../i18n/patientLanguages.ts';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const storagePrefix = 'novaCareTranslations:';
const batchDelayMs = 60;
const observerDelayMs = 120;
const chunkSize = 50;
const translatableAttributes = ['placeholder', 'aria-label', 'title'] as const;

type Target = { node: Text } | { element: Element; attribute: string };

const textCaches = new Map<string, Map<string, string>>();
const originalText = new WeakMap<Node, string>();
const originalAttributes = new WeakMap<Element, Record<string, string>>();
let persistTimer: number | undefined;

function cacheFor(language: PatientLanguage): Map<string, string> {
  let cache = textCaches.get(language);
  if (!cache) {
    cache = new Map();
    try {
      const stored = window.localStorage.getItem(`${storagePrefix}${language}`);
      const parsed: unknown = stored ? JSON.parse(stored) : undefined;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string') cache.set(key, value);
        }
      }
    } catch {
      window.localStorage.removeItem(`${storagePrefix}${language}`);
    }
    textCaches.set(language, cache);
  }
  return cache;
}

function persistCaches() {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    for (const [language, cache] of textCaches) {
      try {
        window.localStorage.setItem(`${storagePrefix}${language}`, JSON.stringify(Object.fromEntries(cache)));
      } catch {
        return;
      }
    }
  }, 400);
}

function isTranslatable(value: string): boolean {
  return value.trim().length > 1 && /[A-Za-z\u00C0-\u1FFF]/.test(value);
}

function isSkipped(element: Element | null): boolean {
  return element !== null && element.closest('[data-no-translate]') !== null;
}

function restoreOriginals(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const original = originalText.get(node);
    if (original === undefined) continue;
    const current = node.nodeValue ?? '';
    const leading = current.match(/^\s*/)?.[0] ?? '';
    const trailing = current.match(/\s*$/)?.[0] ?? '';
    node.nodeValue = `${leading}${original}${trailing}`;
    originalText.delete(node);
  }
  for (const element of root.querySelectorAll('[placeholder], [aria-label], [title]')) {
    const originals = originalAttributes.get(element);
    if (!originals) continue;
    for (const [attribute, value] of Object.entries(originals)) element.setAttribute(attribute, value);
    originalAttributes.delete(element);
  }
}

export function useLiveTranslation(rootRef: RefObject<HTMLElement | null>, language: PatientLanguage) {
  useEffect(() => {
    if (!rootRef.current) return;
    const root: HTMLElement = rootRef.current;

    if (language === 'en') {
      restoreOriginals(root);
      return;
    }

    const cache = cacheFor(language);
    const pendingTargets = new Map<string, Set<Target>>();
    let batchTimer: number | undefined;
    let observerTimer: number | undefined;
    let retryTimer: number | undefined;
    let retryCount = 0;
    let disposed = false;

    function applyTarget(target: Target, translation: string) {
      if ('node' in target) {
        if (!target.node.isConnected) return;
        const current = target.node.nodeValue ?? '';
        const leading = current.match(/^\s*/)?.[0] ?? '';
        const trailing = current.match(/\s*$/)?.[0] ?? '';
        target.node.nodeValue = `${leading}${translation}${trailing}`;
        return;
      }
      if (target.element.isConnected) target.element.setAttribute(target.attribute, translation);
    }

    function queueTarget(key: string, target: Target) {
      const translation = cache.get(key);
      if (translation !== undefined) {
        applyTarget(target, translation);
        return;
      }
      let targets = pendingTargets.get(key);
      if (!targets) {
        targets = new Set();
        pendingTargets.set(key, targets);
      }
      targets.add(target);
    }

    function scheduleFlush() {
      if (batchTimer !== undefined) return;
      batchTimer = window.setTimeout(() => {
        batchTimer = undefined;
        void flush();
      }, batchDelayMs);
    }

    function requeue(batch: Map<string, Set<Target>>) {
      for (const [text, targets] of batch) for (const target of targets) queueTarget(text, target);
    }

    function scheduleRetry(batch: Map<string, Set<Target>>) {
      if (disposed || retryTimer !== undefined || retryCount >= 3) return;
      retryCount += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        requeue(batch);
        scheduleFlush();
      }, 6000);
    }

    async function flush() {
      if (disposed || pendingTargets.size === 0) return;
      const batch = new Map(pendingTargets);
      pendingTargets.clear();
      const texts = [...batch.keys()];
      try {
        for (let index = 0; index < texts.length; index += chunkSize) {
          const chunk = texts.slice(index, index + chunkSize);
          const response = await fetch(`${apiBaseUrl}/api/v1/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: chunk, target: language }),
          });
          if (!response.ok) { requeue(batch); scheduleRetry(batch); return; }
          const payload: unknown = await response.json();
          const translations = (payload as { data?: { translations?: unknown } }).data?.translations;
          if (!Array.isArray(translations)) { requeue(batch); scheduleRetry(batch); return; }
          chunk.forEach((text, chunkIndex) => {
            const translation = translations[chunkIndex];
            if (typeof translation !== 'string' || !translation.trim()) return;
            cache.set(text, translation);
            const targets = batch.get(text);
            if (targets) for (const target of targets) applyTarget(target, translation);
          });
        }
        retryCount = 0;
        persistCaches();
      } catch {
        requeue(batch);
        scheduleRetry(batch);
      }
    }

    function collect() {
      if (disposed) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || isSkipped(parent)) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
          const value = node.nodeValue ?? '';
          if (!isTranslatable(value)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const textNodes: Text[] = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
      for (const node of textNodes) {
        const value = node.nodeValue ?? '';
        const key = (originalText.get(node) ?? value).trim();
        if (!key) continue;
        if (!originalText.has(node)) originalText.set(node, key);
        if (cache.get(key) === value.trim() && cache.has(key)) continue;
        queueTarget(key, { node });
      }
      for (const element of root.querySelectorAll('[placeholder], [aria-label], [title]')) {
        if (isSkipped(element)) continue;
        const originals = originalAttributes.get(element) ?? {};
        for (const attribute of translatableAttributes) {
          const value = element.getAttribute(attribute);
          if (value === null || !isTranslatable(value)) continue;
          const key = originals[attribute] ?? value.trim();
          originals[attribute] = key;
          originalAttributes.set(element, originals);
          if (cache.get(key) === value.trim() && cache.has(key)) continue;
          queueTarget(key, { element, attribute });
        }
      }
      scheduleFlush();
    }

    const observer = new MutationObserver(() => {
      if (disposed || observerTimer !== undefined) return;
      observerTimer = window.setTimeout(() => {
        observerTimer = undefined;
        collect();
      }, observerDelayMs);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    collect();

    return () => {
      disposed = true;
      observer.disconnect();
      window.clearTimeout(batchTimer);
      window.clearTimeout(observerTimer);
      window.clearTimeout(retryTimer);
    };
  }, [language, rootRef]);
}
