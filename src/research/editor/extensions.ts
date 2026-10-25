// 装配存储扩展、页面与无限画布视图扩展，以及编辑器服务。
import { StoreExtensionManager, ViewExtensionManager } from '@editor/extensions';
import { getInternalStoreExtensions } from '@editor/extensions/store';
import { getInternalViewExtensions } from '@editor/extensions/view';
import { ColorScheme, type DocMode } from '@editor/model';
import {
  DocModeProvider,
  type EditorSetting,
  EditorSettingExtension,
  GeneralSettingSchema,
  ThemeExtensionIdentifier,
} from '@editor/shared/services';
import type { ExtensionType } from '@editor/document';
import { signal, type Signal } from '@preact/signals-core';
import { Subject } from 'rxjs';

let storeManager: StoreExtensionManager | null = null;
let viewManager: ViewExtensionManager | null = null;

export function getStoreExtensions(): ExtensionType[] {
  storeManager ??= new StoreExtensionManager(getInternalStoreExtensions());
  return storeManager.get('store');
}

function getViewManager() {
  viewManager ??= new ViewExtensionManager(getInternalViewExtensions());
  return viewManager;
}

/** 应用与画布共用的配色信号，由界面主题切换驱动。 */
export const editorColorScheme: Signal<ColorScheme> = signal(ColorScheme.Light);

export function setEditorColorScheme(dark: boolean) {
  editorColorScheme.value = dark ? ColorScheme.Dark : ColorScheme.Light;
}

const editorSetting$ = signal<EditorSetting>(
  Object.entries(GeneralSettingSchema.shape).reduce((setting, [key, schema]) => {
    (setting as Record<string, unknown>)[key] = (schema as { parse: (value: unknown) => unknown }).parse(undefined);
    return setting;
  }, {} as EditorSetting)
);

const ThemeExtension: ExtensionType = {
  setup: di => {
    di.addImpl(ThemeExtensionIdentifier, () => ({
      getAppTheme: () => editorColorScheme,
      getEdgelessTheme: () => editorColorScheme,
    }));
  },
};

/** 文稿的主模式：画布文稿使用 edgeless，研究文稿使用 page。 */
const primaryModes = new Map<string, DocMode>();
const modeSubjects = new Map<string, Subject<DocMode>>();

export function setPrimaryMode(docId: string, mode: DocMode) {
  primaryModes.set(docId, mode);
  modeSubjects.get(docId)?.next(mode);
}

function docModeExtension(getMode: () => DocMode, setMode: (mode: DocMode) => void): ExtensionType {
  const service: DocModeProvider = {
    getPrimaryMode: docId => primaryModes.get(docId) ?? 'page',
    setPrimaryMode: (mode, docId) => setPrimaryMode(docId, mode),
    togglePrimaryMode: docId => {
      const mode = (primaryModes.get(docId) ?? 'page') === 'page' ? 'edgeless' : 'page';
      setPrimaryMode(docId, mode);
      return mode;
    },
    onPrimaryModeChange: (handler, docId) => {
      if (!modeSubjects.has(docId)) modeSubjects.set(docId, new Subject());
      return modeSubjects.get(docId)!.subscribe(handler);
    },
    getEditorMode: getMode,
    setEditorMode: setMode,
  };
  return { setup: di => { di.override(DocModeProvider, () => service); } };
}

export function getEditorSpecs(options: { getMode: () => DocMode; setMode: (mode: DocMode) => void; extra?: ExtensionType[] }) {
  const manager = getViewManager();
  const common: ExtensionType[] = [
    EditorSettingExtension({ setting$: editorSetting$ }),
    ThemeExtension,
    docModeExtension(options.getMode, options.setMode),
    ...(options.extra ?? []),
  ];
  return {
    page: [...manager.get('page'), ...common],
    edgeless: [...manager.get('edgeless'), ...common],
  };
}
