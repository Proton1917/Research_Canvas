import {
  type Color,
  ColorScheme,
  type ShapeElementModel,
} from '@editor/model';
import { FeatureFlagService } from '@editor/shared/services';
import { requestConnectedFrame } from '@editor/shared/utils';
import { DisposableGroup } from '@editor/platform/disposable';
import {
  type Bound,
  getBoundWithRotation,
  intersects,
} from '@editor/platform/gfx';
import type { BlockStdScope } from '@editor/runtime';
import type {
  GfxCompatibleInterface,
  GridManager,
  LayerManager,
  SurfaceBlockModel,
  Viewport,
} from '@editor/runtime/gfx';
import { Subject } from 'rxjs';

import type { SurfaceElementModel } from '../element-model/base.js';
import type { DomElementRenderer } from './dom-elements/index.js';
import { DomElementRendererIdentifier } from './dom-elements/index.js';
import type { Overlay } from './overlay.js';

type EnvProvider = {
  generateColorProperty: (color: Color, fallback?: Color) => string;
  getColorScheme: () => ColorScheme;
  getColorValue: (color: Color, fallback?: Color, real?: boolean) => string;
  getPropertyValue: (property: string) => string;
  selectedElements?: () => string[];
};

type RendererOptions = {
  std: BlockStdScope;
  viewport: Viewport;
  layerManager: LayerManager;
  provider?: Partial<EnvProvider>;
  gridManager: GridManager;
  surfaceModel: SurfaceBlockModel;
};

const UpdateType = {
  ELEMENT_ADDED: 'element-added',
  ELEMENT_REMOVED: 'element-removed',
  ELEMENT_UPDATED: 'element-updated',
  VIEWPORT_CHANGED: 'viewport-changed',
  SIZE_CHANGED: 'size-changed',
  ZOOM_STATE_CHANGED: 'zoom-state-changed',
} as const;

type UpdateType = (typeof UpdateType)[keyof typeof UpdateType];

interface IncrementalUpdateState {
  dirtyElementIds: Set<string>;
  viewportDirty: boolean;
  sizeDirty: boolean;
  usePlaceholderDirty: boolean;
  pendingUpdates: Map<string, UpdateType[]>;
}

const PLACEHOLDER_RESET_STYLES = {
  border: 'none',
  borderRadius: '0',
  boxShadow: 'none',
  opacity: '1',
};

function calculatePlaceholderRect(
  elementModel: SurfaceElementModel,
  viewportBounds: Bound,
  zoom: number
) {
  return {
    transform: elementModel.rotate ? `rotate(${elementModel.rotate}deg)` : '',
    left: `${(elementModel.x - viewportBounds.x) * zoom}px`,
    top: `${(elementModel.y - viewportBounds.y) * zoom}px`,
    width: `${elementModel.w * zoom}px`,
    height: `${elementModel.h * zoom}px`,
  };
}

function calculateFullElementRect(
  elementModel: SurfaceElementModel,
  viewportBounds: Bound,
  zoom: number
) {
  const dx = elementModel.x - viewportBounds.x;
  const dy = elementModel.y - viewportBounds.y;
  return {
    left: `${dx * zoom}px`,
    top: `${dy * zoom}px`,
  };
}

function getOpacity(elementModel: SurfaceElementModel) {
  return { opacity: `${elementModel.opacity ?? 1}` };
}

/**
 * 使用 DOM 和 CSS 绘制画布元素。
 * 自定义绘制函数接收模型、目标 HTMLElement 和 DomRenderer，
 * 通过 DomElementRendererExtension 注册到编辑扩展容器。
 * 渲染时按 DomElementRendererIdentifier 查找并调用相应函数。
 * 图形实现见 src/editor/canvas/shape/element-renderer/shape-dom/。
 */
export class DomRenderer {
  private _container!: HTMLElement;

  private readonly _disposables = new DisposableGroup();

  private readonly _turboEnabled: () => boolean;

  private readonly _overlays = new Set<Overlay>();

  private _refreshRafId: number | null = null;

  private _sizeUpdatedRafId: number | null = null;

  private readonly _updateState: IncrementalUpdateState = {
    dirtyElementIds: new Set(),
    viewportDirty: false,
    sizeDirty: false,
    usePlaceholderDirty: false,
    pendingUpdates: new Map(),
  };

  private _lastViewportBounds: Bound | null = null;
  private _lastZoom: number | null = null;
  private _lastUsePlaceholder: boolean = false;

  rootElement: HTMLElement;

  private readonly _elementsMap = new Map<string, HTMLElement>();

  std: BlockStdScope;

  grid: GridManager;

  layerManager: LayerManager;

  provider: Partial<EnvProvider>;

  usePlaceholder = false;

  viewport: Viewport;

  elementsUpdated = new Subject<{
    elements: HTMLElement[];
    added: HTMLElement[];
    removed: HTMLElement[];
  }>();

  constructor(options: RendererOptions) {
    this.rootElement = document.createElement('div');
    this.rootElement.classList.add('dom-renderer-root');
    this.rootElement.style.pointerEvents = 'none';

    this.std = options.std;
    this.viewport = options.viewport;
    this.layerManager = options.layerManager;
    this.grid = options.gridManager;
    this.provider = options.provider ?? {};

    this._turboEnabled = () => {
      const featureFlagService = options.std.get(FeatureFlagService);
      return featureFlagService.getFlag('enable_turbo_renderer');
    };

    this._initViewport();
    this._watchSurface(options.surfaceModel);
  }

  private _initViewport() {
    this._disposables.add(
      this.viewport.viewportUpdated.subscribe(() => {
        this._markViewportDirty();
        this.refresh();
      })
    );

    this._disposables.add(
      this.viewport.sizeUpdated.subscribe(() => {
        if (this._sizeUpdatedRafId) return;
        this._sizeUpdatedRafId = requestConnectedFrame(() => {
          this._sizeUpdatedRafId = null;
          this._markSizeDirty();
          this._resetSize();
          this._render();
          this.refresh();
        }, this._container);
      })
    );

    this._disposables.add(
      this.viewport.zooming$.subscribe(isZooming => {
        const shouldRenderPlaceholders = this._turboEnabled() && isZooming;

        if (this.usePlaceholder !== shouldRenderPlaceholders) {
          this.usePlaceholder = shouldRenderPlaceholders;
          this._markUsePlaceholderDirty();
          this.refresh();
        }
      })
    );

    this.usePlaceholder = false;
  }

  private _resetSize() {
    this.refresh();
  }

  private _renderElement(
    elementModel: SurfaceElementModel,
    domElement: HTMLElement
  ) {
    const renderFn = this.std.getOptional<DomElementRenderer>(
      DomElementRendererIdentifier(elementModel.type)
    );

    if (renderFn) {
      renderFn(elementModel, domElement, this);
    } else {
      // If no specific renderer is found (e.g., for 'shape' if the extension isn't registered,
      // or for other element types without a dedicated DOM renderer),
      // no specific DOM styling will be applied here by _renderElement.
      // Basic properties like position/size are handled in the _render loop if usePlaceholder is false.
      console.warn(
        `No DOM renderer found for element type: ${elementModel.type}`
      );
    }
  }

  private _renderOrUpdatePlaceholder(
    elementModel: SurfaceElementModel,
    viewportBounds: Bound,
    zoom: number,
    addedElements: HTMLElement[]
  ) {
    let domElement = this._elementsMap.get(elementModel.id);

    if (!domElement) {
      domElement = document.createElement('div');
      domElement.dataset.elementId = elementModel.id;
      domElement.style.position = 'absolute';
      domElement.style.backgroundColor = 'rgba(200, 200, 200, 0.5)';
      this._elementsMap.set(elementModel.id, domElement);
      this.rootElement.append(domElement);
      addedElements.push(domElement);
    }

    const geometricStyles = calculatePlaceholderRect(
      elementModel,
      viewportBounds,
      zoom
    );
    Object.assign(domElement.style, geometricStyles);
    Object.assign(domElement.style, PLACEHOLDER_RESET_STYLES);

    // Clear classes specific to shapes, if applicable
    if (elementModel.type === 'shape') {
      const shapeModel = elementModel as ShapeElementModel;
      domElement.classList.remove(`shape-${shapeModel.shapeType}`);
      domElement.classList.remove(
        `shape-style-${shapeModel.shapeStyle.toLowerCase()}`
      );
    }
  }

  private _renderOrUpdateFullElement(
    elementModel: SurfaceElementModel,
    viewportBounds: Bound,
    zoom: number,
    addedElements: HTMLElement[]
  ) {
    let domElement = this._elementsMap.get(elementModel.id);

    if (!domElement) {
      domElement = document.createElement('div');
      domElement.dataset.elementId = elementModel.id;
      domElement.style.position = 'absolute';
      domElement.style.transformOrigin = 'top left';
      this._elementsMap.set(elementModel.id, domElement);
      this.rootElement.append(domElement);
      addedElements.push(domElement);
    }

    const geometricStyles = calculateFullElementRect(
      elementModel,
      viewportBounds,
      zoom
    );
    const opacityStyle = getOpacity(elementModel);
    Object.assign(domElement.style, geometricStyles, opacityStyle);

    this._renderElement(elementModel, domElement);
  }

  private _render() {
    this._renderIncremental();
  }

  private _watchSurface(surfaceModel: SurfaceBlockModel) {
    this._disposables.add(
      surfaceModel.elementAdded.subscribe(payload => {
        this._markElementDirty(payload.id, UpdateType.ELEMENT_ADDED);
        this.refresh();
      })
    );
    this._disposables.add(
      surfaceModel.elementRemoved.subscribe(payload => {
        this._markElementDirty(payload.id, UpdateType.ELEMENT_REMOVED);
        this.refresh();
      })
    );
    this._disposables.add(
      surfaceModel.localElementAdded.subscribe(payload => {
        this._markElementDirty(payload.id, UpdateType.ELEMENT_ADDED);
        this.refresh();
      })
    );
    this._disposables.add(
      surfaceModel.localElementDeleted.subscribe(payload => {
        this._markElementDirty(payload.id, UpdateType.ELEMENT_REMOVED);
        this.refresh();
      })
    );
    this._disposables.add(
      surfaceModel.localElementUpdated.subscribe(payload => {
        this._markElementDirty(payload.model.id, UpdateType.ELEMENT_UPDATED);
        this.refresh();
      })
    );

    this._disposables.add(
      surfaceModel.elementUpdated.subscribe(payload => {
        // ignore externalXYWH update cause it's updated by the renderer
        if (payload.props['externalXYWH']) return;
        this._markElementDirty(payload.id, UpdateType.ELEMENT_UPDATED);
        this.refresh();
      })
    );
  }

  addOverlay = (overlay: Overlay) => {
    overlay.setRenderer(null);
    this._overlays.add(overlay);
    this.refresh();
  };

  attach = (container: HTMLElement) => {
    this._container = container;
    container.append(this.rootElement);

    this._resetSize();
    this.refresh();
  };

  dispose = () => {
    this._overlays.forEach(overlay => overlay.dispose());
    this._overlays.clear();
    this._disposables.dispose();

    if (this._refreshRafId) {
      cancelAnimationFrame(this._refreshRafId);
      this._refreshRafId = null;
    }
    if (this._sizeUpdatedRafId) {
      cancelAnimationFrame(this._sizeUpdatedRafId);
      this._sizeUpdatedRafId = null;
    }

    this.rootElement.remove();
    this._elementsMap.clear();
  };

  generateColorProperty = (color: Color, fallback?: Color) => {
    return (
      this.provider.generateColorProperty?.(color, fallback) ?? 'transparent'
    );
  };

  getColorScheme = () => {
    return this.provider.getColorScheme?.() ?? ColorScheme.Light;
  };

  getColorValue = (color: Color, fallback?: Color, real?: boolean) => {
    return (
      this.provider.getColorValue?.(color, fallback, real) ?? 'transparent'
    );
  };

  getPropertyValue = (property: string) => {
    return this.provider.getPropertyValue?.(property) ?? '';
  };

  refresh = () => {
    if (this._refreshRafId !== null) return;

    this._refreshRafId = requestConnectedFrame(() => {
      this._refreshRafId = null;
      this._render();
    }, this._container);
  };

  removeOverlay = (overlay: Overlay) => {
    if (!this._overlays.has(overlay)) {
      return;
    }

    this._overlays.delete(overlay);
    this.refresh();
  };

  /**
   * Mark a specific element as dirty for incremental updates
   * @param elementId - The ID of the element to mark as dirty
   * @param updateType - The type of update (optional, defaults to ELEMENT_UPDATED)
   */
  markElementDirty = (
    elementId: string,
    updateType: UpdateType = UpdateType.ELEMENT_UPDATED
  ) => {
    this._markElementDirty(elementId, updateType);
  };

  /**
   * Force a full re-render of all elements
   */
  forceFullRender = () => {
    this._updateState.viewportDirty = true;
    this.refresh();
  };

  private _markElementDirty(elementId: string, updateType: UpdateType) {
    this._updateState.dirtyElementIds.add(elementId);
    const currentUpdates =
      this._updateState.pendingUpdates.get(elementId) || [];
    if (!currentUpdates.includes(updateType)) {
      currentUpdates.push(updateType);
      this._updateState.pendingUpdates.set(elementId, currentUpdates);
    }
  }

  private _markViewportDirty() {
    this._updateState.viewportDirty = true;
  }

  private _markSizeDirty() {
    this._updateState.sizeDirty = true;
  }

  private _markUsePlaceholderDirty() {
    this._updateState.usePlaceholderDirty = true;
  }

  private _clearUpdateState() {
    this._updateState.dirtyElementIds.clear();
    this._updateState.viewportDirty = false;
    this._updateState.sizeDirty = false;
    this._updateState.usePlaceholderDirty = false;
    this._updateState.pendingUpdates.clear();
  }

  private _isViewportChanged(): boolean {
    const { viewportBounds, zoom } = this.viewport;

    if (!this._lastViewportBounds || !this._lastZoom) {
      return true;
    }

    return (
      this._lastViewportBounds.x !== viewportBounds.x ||
      this._lastViewportBounds.y !== viewportBounds.y ||
      this._lastViewportBounds.w !== viewportBounds.w ||
      this._lastViewportBounds.h !== viewportBounds.h ||
      this._lastZoom !== zoom
    );
  }

  private _isUsePlaceholderChanged(): boolean {
    return this._lastUsePlaceholder !== this.usePlaceholder;
  }

  private _updateLastState() {
    const { viewportBounds, zoom } = this.viewport;
    this._lastViewportBounds = {
      x: viewportBounds.x,
      y: viewportBounds.y,
      w: viewportBounds.w,
      h: viewportBounds.h,
    } as Bound;
    this._lastZoom = zoom;
    this._lastUsePlaceholder = this.usePlaceholder;
  }

  private _renderIncremental() {
    const { viewportBounds, zoom } = this.viewport;
    const addedElements: HTMLElement[] = [];
    const elementsToRemove: HTMLElement[] = [];

    const needsFullRender =
      this._isViewportChanged() ||
      this._isUsePlaceholderChanged() ||
      this._updateState.sizeDirty ||
      this._updateState.viewportDirty ||
      this._updateState.usePlaceholderDirty;

    if (needsFullRender) {
      this._renderFull();
      this._updateLastState();
      this._clearUpdateState();
      return;
    }

    // Only update dirty elements
    const elementsFromGrid = this.grid.search(viewportBounds, {
      filter: ['canvas', 'local'],
    }) as SurfaceElementModel[];

    const visibleElementIds = new Set<string>();

    // 1. Update dirty elements
    for (const elementModel of elementsFromGrid) {
      const display = (elementModel.display ?? true) && !elementModel.hidden;
      if (
        display &&
        intersects(getBoundWithRotation(elementModel), viewportBounds)
      ) {
        visibleElementIds.add(elementModel.id);

        // Only update dirty elements
        if (this._updateState.dirtyElementIds.has(elementModel.id)) {
          if (
            this.usePlaceholder &&
            !(elementModel as GfxCompatibleInterface).forceFullRender
          ) {
            this._renderOrUpdatePlaceholder(
              elementModel,
              viewportBounds,
              zoom,
              addedElements
            );
          } else {
            this._renderOrUpdateFullElement(
              elementModel,
              viewportBounds,
              zoom,
              addedElements
            );
          }
        }
      }
    }

    // 2. Remove elements that are no longer in the grid
    for (const elementId of this._updateState.dirtyElementIds) {
      const updateTypes = this._updateState.pendingUpdates.get(elementId) || [];
      if (
        updateTypes.includes(UpdateType.ELEMENT_REMOVED) ||
        !visibleElementIds.has(elementId)
      ) {
        const domElem = this._elementsMap.get(elementId);
        if (domElem) {
          domElem.remove();
          this._elementsMap.delete(elementId);
          elementsToRemove.push(domElem);
        }
      }
    }

    // 3. Notify changes
    if (addedElements.length > 0 || elementsToRemove.length > 0) {
      this.elementsUpdated.next({
        elements: Array.from(this._elementsMap.values()),
        added: addedElements,
        removed: elementsToRemove,
      });
    }

    this._updateLastState();
    this._clearUpdateState();
  }

  private _renderFull() {
    const { viewportBounds, zoom } = this.viewport;
    const addedElements: HTMLElement[] = [];
    const elementsToRemove: HTMLElement[] = [];

    // Step 1: Handle elements whose models are deleted from the surface
    const prevRenderedElementIds = Array.from(this._elementsMap.keys());
    for (const id of prevRenderedElementIds) {
      const modelExists = this.layerManager.layers.some(layer =>
        layer.elements.some(elem => (elem as SurfaceElementModel).id === id)
      );
      if (!modelExists) {
        const domElem = this._elementsMap.get(id);
        if (domElem) {
          domElem.remove();
          this._elementsMap.delete(id);
          elementsToRemove.push(domElem);
        }
      }
    }

    // Step 2: Render elements in the current viewport
    const elementsFromGrid = this.grid.search(viewportBounds, {
      filter: ['canvas', 'local'],
    }) as SurfaceElementModel[];
    const visibleElementIds = new Set<string>();

    for (const elementModel of elementsFromGrid) {
      const display = (elementModel.display ?? true) && !elementModel.hidden;
      if (
        display &&
        intersects(getBoundWithRotation(elementModel), viewportBounds)
      ) {
        visibleElementIds.add(elementModel.id);

        if (
          this.usePlaceholder &&
          !(elementModel as GfxCompatibleInterface).forceFullRender
        ) {
          this._renderOrUpdatePlaceholder(
            elementModel,
            viewportBounds,
            zoom,
            addedElements
          );
        } else {
          // Full render
          this._renderOrUpdateFullElement(
            elementModel,
            viewportBounds,
            zoom,
            addedElements
          );
        }
      }
    }

    // Step 3: Remove DOM elements that are in _elementsMap but were not processed in Step 2
    const currentRenderedElementIds = Array.from(this._elementsMap.keys());
    for (const id of currentRenderedElementIds) {
      if (!visibleElementIds.has(id)) {
        const domElem = this._elementsMap.get(id);
        if (domElem) {
          domElem.remove();
          this._elementsMap.delete(id);
          if (!elementsToRemove.includes(domElem)) {
            elementsToRemove.push(domElem);
          }
        }
      }
    }

    // Step 4: Notify about changes
    if (addedElements.length > 0 || elementsToRemove.length > 0) {
      this.elementsUpdated.next({
        elements: Array.from(this._elementsMap.values()),
        added: addedElements,
        removed: elementsToRemove,
      });
    }
  }
}
