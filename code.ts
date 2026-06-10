// HTML to Figma — Figma Plugin Main Thread
/* eslint-disable */
declare function atob(data: string): string;
// Receives design tree from ui.html and creates Figma nodes

figma.showUI(__html__, { width: 420, height: 660, title: 'HTML to Figma' });

// ─── Types ────────────────────────────────────────────────────────────────

interface RGBAColor { r: number; g: number; b: number; a: number; }

interface ShadowEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW';
  color: RGBAColor;
  offsetX: number; offsetY: number;
  blur: number; spread: number;
  visible: boolean;
}

interface GradientStop { position: number; color: RGBAColor; }
interface GradientFill {
  type: 'LINEAR_GRADIENT' | 'RADIAL_GRADIENT';
  stops: GradientStop[];
  angle?: number;
}

interface StrokeWeights {
  top: number; right: number; bottom: number; left: number;
}

interface DesignNode {
  type: 'frame' | 'text' | 'image' | 'svg';
  name: string;
  x: number; y: number;
  width: number; height: number;
  display?: string;
  // Frame
  backgroundColor?: RGBAColor;
  cornerRadius?: number;
  cornerRadii?: [number, number, number, number];
  strokeColor?: RGBAColor;
  strokeWeight?: number;
  strokeWeights?: StrokeWeights;
  opacity?: number;
  rotation?: number;
  clipsContent?: boolean;
  shadows?: ShadowEffect[];
  blur?: number;
  backdropBlur?: number;
  gradientFill?: GradientFill;
  blendMode?: string;
  // Auto-layout
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
  itemSpacing?: number;
  paddingTop?: number; paddingRight?: number;
  paddingBottom?: number; paddingLeft?: number;
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX';
  // Text
  characters?: string;
  fontSize?: number;
  fontFamily?: string;
  fontStyle?: string;
  fontWeight?: number;
  textColor?: RGBAColor;
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  lineHeightPx?: number;
  letterSpacing?: number;
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  // Image
  imageData?: string; // base64 data URL
  // SVG
  svgContent?: string;
  // CSS position / flex (for auto-layout child handling)
  position?: string;   // 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky'
  flexGrow?: number;
  flexShrink?: number;
  alignSelf?: string;
  flexWrap?: string;
  rowGap?: number;
  // Children
  children?: DesignNode[];
}

interface Settings {
  autoLayout: boolean;
  detectComponents: boolean;
  editableText: boolean;
  designTokens: boolean;
  renderMode?: 'auto' | 'semantic' | 'dom';
}

// Semantic extraction tree (produced by the semantic pipeline in ui.html)
interface SemanticNode {
  mode: 'semantic';
  type: string;
  tag?: string;
  name: string;
  text?: string;
  level?: number;
  width?: number;
  height?: number;
  background?: RGBAColor | null;
  color?: RGBAColor;
  borderRadius?: number;
  fontFamily?: string;
  fontStyle?: string;
  fontSize?: number;
  lineHeight?: number;
  textAlign?: string;
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
  paddingTop?: number;  paddingRight?: number;
  paddingBottom?: number; paddingLeft?: number;
  gap?: number;
  imageData?: string;
  svgContent?: string;
  strokeColor?: RGBAColor;
  strokeWeight?: number;
  bgImageData?: string;
  tokens?: Record<string, string>;
  children?: SemanticNode[];
}

// ─── Message Handler ──────────────────────────────────────────────────────

figma.ui.onmessage = async function(msg) {
  if (msg.type === 'import-screenshot') {
    await handleScreenshotImport(msg.imageData as string, msg.width as number, msg.height as number, msg.name as string);
  } else if (msg.type === 'import') {
    const settings = msg.settings as Settings;
    if (msg.tree && (msg.tree as SemanticNode).mode === 'semantic') {
      await handleSemanticImport(msg.tree as SemanticNode, settings);
    } else {
      await handleImport(msg.tree as DesignNode, settings);
    }
  } else if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};

// ─── Import Orchestrator ──────────────────────────────────────────────────

async function handleImport(tree: DesignNode, settings: Settings) {
  try {
    sendProgress('Collecting fonts…', 5);
    const fonts = new Set<string>();
    collectFonts(tree, fonts);

    sendProgress('Loading fonts…', 15);
    await loadAllFonts(Array.from(fonts));

    sendProgress('Building frames…', 30);
    const rootNode = await buildNode(tree, 0, 0, settings, false);
    expandRootToFitChildren(rootNode as SceneNode);

    figma.currentPage.appendChild(rootNode as SceneNode);
    figma.currentPage.selection = [rootNode as SceneNode];
    figma.viewport.scrollAndZoomIntoView([rootNode as SceneNode]);

    sendProgress('Done', 100);
    figma.ui.postMessage({ type: 'complete' });
  } catch (err) {
    const msg = (err instanceof Error) ? err.message : String(err);
    figma.ui.postMessage({ type: 'error', message: msg });
  }
}

// ─── Screenshot Import ────────────────────────────────────────────────────

async function handleScreenshotImport(imageData: string, width: number, height: number, name: string) {
  try {
    sendProgress('Decoding image…', 20);
    const b64   = imageData.includes(',') ? imageData.split(',')[1] : imageData;
    const bytes = figma.base64Decode(b64);
    const img   = figma.createImage(bytes);

    sendProgress('Creating frame…', 60);
    const frame = figma.createFrame();
    frame.name  = (name || 'Screenshot').replace(/^https?:\/\//, '').split('/')[0];
    frame.resize(Math.max(width || 1440, 1), Math.max(height || 900, 1));
    frame.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }];
    frame.clipsContent = false;

    figma.currentPage.appendChild(frame);
    figma.currentPage.selection = [frame];
    figma.viewport.scrollAndZoomIntoView([frame]);

    sendProgress('Done', 100);
    figma.ui.postMessage({ type: 'complete' });
  } catch (err) {
    const errMsg = (err instanceof Error) ? err.message : String(err);
    figma.ui.postMessage({ type: 'error', message: errMsg });
  }
}

// ─── Semantic Import ──────────────────────────────────────────────────────

async function handleSemanticImport(tree: SemanticNode, settings: Settings) {
  try {
    sendProgress('Collecting fonts…', 5);
    const fonts = new Set<string>();
    collectSemanticFonts(tree, fonts);

    sendProgress('Loading fonts…', 15);
    await loadAllFonts(Array.from(fonts));

    sendProgress('Building semantic layout…', 30);
    const rootNode = await buildSemanticNode(tree, true);
    expandRootToFitChildren(rootNode as SceneNode);

    figma.currentPage.appendChild(rootNode as SceneNode);
    figma.currentPage.selection = [rootNode as SceneNode];
    figma.viewport.scrollAndZoomIntoView([rootNode as SceneNode]);

    sendProgress('Done', 100);
    figma.ui.postMessage({ type: 'complete' });
  } catch (err) {
    const errMsg = (err instanceof Error) ? err.message : String(err);
    figma.ui.postMessage({ type: 'error', message: errMsg });
  }
}

function collectSemanticFonts(node: SemanticNode, acc: Set<string>) {
  if (node.fontFamily) {
    const style = node.fontStyle || 'Regular';
    acc.add(node.fontFamily + '::' + style);
    if (style !== 'Regular') acc.add(node.fontFamily + '::Regular');
  }
  if (node.children) {
    for (const c of node.children) collectSemanticFonts(c, acc);
  }
}

async function buildSemanticNode(node: SemanticNode, isRoot: boolean, parentLayout?: string): Promise<SceneNode> {
  // Text node
  const textTypes = new Set(['text','heading','list-item','label','button-text']);
  if (textTypes.has(node.type) && node.text) {
    return buildSemanticText(node);
  }

  // Image node
  if (node.type === 'image' && node.imageData) {
    return buildSemanticImage(node);
  }

  // SVG node
  if (node.svgContent) {
    try {
      const svgNode = figma.createNodeFromSvg(node.svgContent);
      svgNode.name = node.name;
      if (node.width && node.height) svgNode.resize(node.width, node.height);
      return svgNode;
    } catch(_) { /* fall through to frame */ }
  }

  // Frame / container
  const frame = figma.createFrame();
  frame.name = node.name;
  frame.clipsContent = false;

  // Background
  if (node.background && node.background.a > 0.01) {
    const bg = node.background;
    frame.fills = [{ type: 'SOLID', color: { r: bg.r, g: bg.g, b: bg.b }, opacity: bg.a }];
  } else {
    frame.fills = [];
  }

  // CSS background-image — overrides solid background fill
  if (node.bgImageData) {
    try {
      const raw = node.bgImageData;
      const b64 = raw.includes(',') ? raw.split(',')[1] : raw;
      const bytes = figma.base64Decode(b64);
      const img = figma.createImage(bytes);
      frame.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }];
    } catch(_) { /* keep existing fill */ }
  }

  // Border radius
  if (node.borderRadius && node.borderRadius > 0) {
    frame.cornerRadius = node.borderRadius;
  }

  // Stroke / border
  if (node.strokeColor && (node.strokeWeight || 0) > 0) {
    const sc = node.strokeColor;
    frame.strokes = [{ type: 'SOLID', color: { r: sc.r, g: sc.g, b: sc.b }, opacity: sc.a }];
    frame.strokeWeight = node.strokeWeight!;
    frame.strokeAlign = 'INSIDE';
  }

  // Auto-layout
  const lm = node.layoutMode || 'VERTICAL';
  frame.layoutMode = lm as 'HORIZONTAL' | 'VERTICAL' | 'NONE';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.paddingTop    = node.paddingTop    || 0;
  frame.paddingBottom = node.paddingBottom || 0;
  frame.paddingLeft   = node.paddingLeft   || 0;
  frame.paddingRight  = node.paddingRight  || 0;
  frame.itemSpacing   = node.gap || 0;

  // Width: root and full-width containers are fixed-width; others hug
  if (isRoot || node.type === 'document') {
    const w = node.width || 1440;
    frame.resize(w, 100);
    frame.counterAxisSizingMode = 'FIXED';
    frame.primaryAxisSizingMode = 'AUTO';
  } else if (['nav','header','main','footer','section','hero'].includes(node.type)) {
    // Full-width sections fill the parent
    frame.counterAxisSizingMode = 'AUTO';
    frame.primaryAxisSizingMode = 'AUTO';
    if (node.width && node.width > 100) frame.resize(node.width, 1);
  } else {
    frame.counterAxisSizingMode = 'AUTO';
    frame.primaryAxisSizingMode = 'AUTO';
  }

  // Build children
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      try {
        const childNode = await buildSemanticNode(child, false, lm) as FrameNode;
        frame.appendChild(childNode);

        if (lm === 'VERTICAL' && 'layoutAlign' in childNode) {
          // Stretch children to fill parent width in vertical stacks
          childNode.layoutAlign = 'STRETCH';
        } else if (lm === 'HORIZONTAL' && 'resize' in childNode) {
          // Fix each child's width so columns don't collapse; stretch height to match tallest
          const cw = child.width || 0;
          if (cw > 10) {
            const ch = Math.max((childNode as FrameNode).height || 100, 100);
            (childNode as FrameNode).resize(cw, ch);
            if ('primaryAxisSizingMode' in childNode) {
              (childNode as FrameNode).primaryAxisSizingMode = 'AUTO'; // height hugs
            }
          }
          if ('layoutAlign' in childNode) {
            (childNode as FrameNode).layoutAlign = 'STRETCH'; // fill parent height
          }
        }
      } catch(_) { /* skip failed children */ }
    }
  }

  return frame;
}

async function buildSemanticText(node: SemanticNode): Promise<TextNode> {
  const textNode = figma.createText();
  textNode.name = node.name;

  const family = node.fontFamily || 'Inter';
  const style  = node.fontStyle  || 'Regular';
  const loaded = await tryLoadFont(family, style);
  textNode.fontName = loaded;

  textNode.characters = node.text || '';
  textNode.fontSize = node.fontSize || 16;

  if (node.lineHeight && node.lineHeight > 0) {
    textNode.lineHeight = { value: node.lineHeight, unit: 'PIXELS' };
  }

  if (node.color) {
    const c = node.color;
    textNode.fills = [{ type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }];
  }

  const alignMap: Record<string, 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED'> = {
    left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'JUSTIFIED',
  };
  textNode.textAlignHorizontal = alignMap[node.textAlign || 'left'] || 'LEFT';

  // Let text auto-resize vertically; fix width if we have a meaningful one
  if (node.width && node.width > 20) {
    textNode.textAutoResize = 'HEIGHT';
    textNode.resize(node.width, Math.max(node.height || textNode.height, 10));
  } else {
    textNode.textAutoResize = 'WIDTH_AND_HEIGHT';
  }

  return textNode;
}

function buildSemanticImage(node: SemanticNode): RectangleNode {
  const rect = figma.createRectangle();
  rect.name = node.name;
  rect.resize(Math.max(node.width || 100, 1), Math.max(node.height || 100, 1));
  try {
    const raw   = node.imageData!;
    const b64   = raw.includes(',') ? raw.split(',')[1] : raw;
    const bytes = figma.base64Decode(b64);
    const img   = figma.createImage(bytes);
    rect.fills  = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }];
  } catch(_) {
    rect.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }];
  }
  return rect;
}

// ─── Font Helpers ─────────────────────────────────────────────────────────

function collectFonts(node: DesignNode, acc: Set<string>) {
  if (node.type === 'text') {
    const family = node.fontFamily || 'Inter';
    const style  = node.fontStyle  || 'Regular';
    acc.add(family + '::' + style);
    // Also pre-load the plain Regular in case Italic/Bold variant is missing
    if (style !== 'Regular') acc.add(family + '::Regular');
  }
  const children = node.children;
  if (children) {
    for (let i = 0; i < children.length; i++) collectFonts(children[i], acc);
  }
}

async function loadAllFonts(keys: string[]) {
  const promises = keys.map(function(key) {
    const parts = key.split('::');
    return tryLoadFont(parts[0], parts[1]);
  });
  await Promise.all(promises);
}

async function tryLoadFont(family: string, style: string): Promise<FontName> {
  // Build a priority list: exact match → same weight without italic → inter variants
  const isItalic = style.includes('Italic');
  const baseStyle = style.replace(' Italic', '').replace('Italic', '').trim() || 'Regular';

  const attempts: FontName[] = [
    { family: family, style: style },
  ];
  if (isItalic) {
    attempts.push({ family: family, style: baseStyle });
  }
  attempts.push(
    { family: family,  style: 'Regular' },
    { family: 'Inter', style: style },
    { family: 'Inter', style: baseStyle },
    { family: 'Inter', style: 'Regular' },
  );

  for (let i = 0; i < attempts.length; i++) {
    try { await figma.loadFontAsync(attempts[i]); return attempts[i]; } catch (e) { /* try next */ }
  }
  return { family: 'Inter', style: 'Regular' };
}

// ─── Root Frame Expansion ─────────────────────────────────────────────────
// Recursively find the absolute bottom of every visible descendant (including
// absolutely-positioned nodes deep in the tree) and resize the root frame so
// nothing is clipped. Stops recursing into frames that clip their own content.
function expandRootToFitChildren(root: SceneNode): void {
  if (root.type !== 'FRAME') return;
  const frame = root as FrameNode;
  let maxBottom = frame.height;

  const traverse = (node: SceneNode, absY: number): void => {
    if (!node.visible) return;
    const bottom = absY + node.height;
    if (bottom > maxBottom) maxBottom = bottom;
    if ('children' in node) {
      // Don't recurse past frames that clip their own children
      const clips = 'clipsContent' in node && (node as FrameNode).clipsContent;
      if (!clips) {
        for (const child of (node as FrameNode).children) {
          traverse(child, absY + child.y);
        }
      }
    }
  };

  for (const child of frame.children) traverse(child, child.y);

  if (maxBottom > frame.height) {
    frame.resize(frame.width, Math.ceil(maxBottom));
  }
}

// ─── Node Builder ─────────────────────────────────────────────────────────

async function buildNode(
  node: DesignNode,
  parentAbsX: number,
  parentAbsY: number,
  settings: Settings,
  isAutoLayoutChild: boolean,
): Promise<SceneNode> {

  if (node.type === 'svg') {
    return buildSvgNode(node, parentAbsX, parentAbsY, isAutoLayoutChild);
  }

  if (node.type === 'image') {
    return buildImageNode(node, parentAbsX, parentAbsY, isAutoLayoutChild);
  }

  if (node.type === 'text' && settings.editableText) {
    return buildTextNode(node, parentAbsX, parentAbsY, isAutoLayoutChild);
  }

  if (node.type === 'text' && !settings.editableText) {
    return buildPlaceholderText(node, parentAbsX, parentAbsY, isAutoLayoutChild);
  }

  return buildFrameNode(node, parentAbsX, parentAbsY, settings, isAutoLayoutChild);
}

// ─── SVG Node ─────────────────────────────────────────────────────────────

function buildSvgNode(
  node: DesignNode,
  parentAbsX: number,
  parentAbsY: number,
  isAutoLayoutChild: boolean,
): SceneNode {
  if (node.svgContent) {
    try {
      const svgNode = figma.createNodeFromSvg(node.svgContent);
      svgNode.name = sanitizeName(node.name);
      svgNode.resize(Math.max(node.width, 1), Math.max(node.height, 1));
      if (!isAutoLayoutChild) {
        svgNode.x = Math.round(node.x - parentAbsX);
        svgNode.y = Math.round(node.y - parentAbsY);
      }
      if (node.opacity !== undefined && node.opacity < 1) {
        svgNode.opacity = node.opacity;
      }
      return svgNode;
    } catch (e) {
      // Fall through to image fallback
    }
  }
  // Fallback: grey rectangle
  const rect = figma.createRectangle();
  rect.name = sanitizeName(node.name);
  rect.resize(Math.max(node.width, 1), Math.max(node.height, 1));
  if (!isAutoLayoutChild) {
    rect.x = Math.round(node.x - parentAbsX);
    rect.y = Math.round(node.y - parentAbsY);
  }
  rect.fills = [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }];
  return rect;
}

// ─── Frame Node ───────────────────────────────────────────────────────────

async function buildFrameNode(
  node: DesignNode,
  parentAbsX: number,
  parentAbsY: number,
  settings: Settings,
  isAutoLayoutChild: boolean,
): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = sanitizeName(node.name);

  if (!isAutoLayoutChild) {
    frame.x = Math.round(node.x - parentAbsX);
    frame.y = Math.round(node.y - parentAbsY);
  }
  frame.resize(Math.max(node.width, 1), Math.max(node.height, 1));

  // Background fill or gradient
  if (node.gradientFill && node.gradientFill.stops && node.gradientFill.stops.length >= 2) {
    frame.fills = [buildGradientFill(node.gradientFill, node.width, node.height)];
  } else if (node.backgroundColor && node.backgroundColor.a > 0.01) {
    frame.fills = [{
      type: 'SOLID',
      color: { r: node.backgroundColor.r, g: node.backgroundColor.g, b: node.backgroundColor.b },
      opacity: node.backgroundColor.a,
    }];
  } else {
    frame.fills = [];
  }

  // Border stroke — per-side or uniform
  if (node.strokeColor) {
    const sw = node.strokeWeights;
    const hasPerSide = sw && (sw.top !== sw.right || sw.top !== sw.bottom || sw.top !== sw.left);

    if (hasPerSide && sw) {
      // Apply individual side weights
      const maxW = Math.max(sw.top, sw.right, sw.bottom, sw.left);
      if (maxW > 0) {
        frame.strokes = [{
          type: 'SOLID',
          color: { r: node.strokeColor.r, g: node.strokeColor.g, b: node.strokeColor.b },
          opacity: node.strokeColor.a,
        }];
        frame.strokeAlign = 'INSIDE';
        // Set individual weights — Figma supports these on FrameNode
        (frame as any).strokeTopWeight    = sw.top;
        (frame as any).strokeRightWeight  = sw.right;
        (frame as any).strokeBottomWeight = sw.bottom;
        (frame as any).strokeLeftWeight   = sw.left;
      }
    } else if ((node.strokeWeight || 0) > 0) {
      frame.strokes = [{
        type: 'SOLID',
        color: { r: node.strokeColor.r, g: node.strokeColor.g, b: node.strokeColor.b },
        opacity: node.strokeColor.a,
      }];
      frame.strokeWeight = node.strokeWeight || 1;
      frame.strokeAlign = 'INSIDE';
    }
  }

  // Corner radius — individual or uniform
  if (node.cornerRadii) {
    const radii = node.cornerRadii;
    (frame as any).topLeftRadius    = radii[0];
    (frame as any).topRightRadius   = radii[1];
    (frame as any).bottomRightRadius = radii[2];
    (frame as any).bottomLeftRadius  = radii[3];
  } else if (node.cornerRadius && node.cornerRadius > 0) {
    frame.cornerRadius = Math.round(node.cornerRadius);
  }

  // Opacity
  if (node.opacity !== undefined && node.opacity < 1) {
    frame.opacity = node.opacity;
  }

  // Rotation
  if (node.rotation) {
    frame.rotation = node.rotation;
  }

  // Clip content
  frame.clipsContent = node.clipsContent || false;

  // Effects: shadows + layer blur + background blur
  const effects: Effect[] = [];

  if (node.shadows && node.shadows.length > 0) {
    for (const s of node.shadows) {
      effects.push({
        type: s.type,
        color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
        offset: { x: s.offsetX, y: s.offsetY },
        radius: s.blur,
        spread: s.spread,
        visible: true,
        blendMode: 'NORMAL',
      } as Effect);
    }
  }

  if (node.blur && node.blur > 0) {
    effects.push({ type: 'LAYER_BLUR', radius: node.blur, visible: true } as Effect);
  }

  if (node.backdropBlur && node.backdropBlur > 0) {
    effects.push({ type: 'BACKGROUND_BLUR', radius: node.backdropBlur, visible: true } as Effect);
  }

  if (effects.length > 0) {
    frame.effects = effects;
  }

  // Blend mode
  if (node.blendMode && node.blendMode !== 'normal' && node.blendMode !== 'NORMAL') {
    try {
      frame.blendMode = cssBlendToFigma(node.blendMode);
    } catch (_) {}
  }

  // Auto-layout: enable for CSS flex/grid containers automatically.
  // Absolute/fixed children opt out of the flow via layoutPositioning = 'ABSOLUTE'.
  const useLayout = !!node.layoutMode && node.layoutMode !== 'NONE';
  if (useLayout) {
    frame.layoutMode = node.layoutMode as 'HORIZONTAL' | 'VERTICAL';
    frame.itemSpacing = Math.max(0, Math.round(node.itemSpacing || 0));
    if (node.primaryAxisAlignItems) frame.primaryAxisAlignItems = node.primaryAxisAlignItems;
    if (node.counterAxisAlignItems) frame.counterAxisAlignItems = node.counterAxisAlignItems;
    // VERTICAL stacks: fix width, let height hug content downward
    // HORIZONTAL rows: fix both axes; flex-wrap counter axis = AUTO to allow row wrapping
    if (node.layoutMode === 'VERTICAL') {
      frame.counterAxisSizingMode = 'FIXED';
      frame.primaryAxisSizingMode = 'AUTO';
    } else {
      frame.primaryAxisSizingMode = 'FIXED';
      frame.counterAxisSizingMode = node.flexWrap === 'wrap' ? 'AUTO' : 'FIXED';
    }
    if (node.flexWrap === 'wrap') {
      try {
        (frame as any).layoutWrap = 'WRAP';
        (frame as any).counterAxisSpacing = Math.max(0, Math.round(node.rowGap || node.itemSpacing || 0));
      } catch(_) {}
    } else {
      (frame as any).layoutWrap = 'NO_WRAP';
    }
  }

  // Layout frames: lock width only — let height hug stacked content
  // Absolute-positioned frames: lock both dimensions to exact measured values
  try {
    if (useLayout) {
      frame.resize(Math.max(node.width, 1), frame.height);
    } else {
      frame.resize(Math.max(node.width, 1), Math.max(node.height, 1));
    }
  } catch(_) {}

  // Children
  // All children enter as auto-layout flow items; absolute ones are escaped after append.
  const childIsAuto = useLayout;
  const children = node.children || [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childNode = await buildNode(child, node.x, node.y, settings, childIsAuto);
    frame.appendChild(childNode);

    if (useLayout) {
      const isAbsChild = child.position === 'absolute' || child.position === 'fixed';
      if (isAbsChild) {
        // Escape from the flex flow; position is relative to the parent frame origin.
        (childNode as any).layoutPositioning = 'ABSOLUTE';
        // Explicitly set coordinates now that the node has escaped the flow —
        // auto-layout may have moved the node before layoutPositioning was set.
        (childNode as any).x = Math.round(child.x - node.x);
        (childNode as any).y = Math.round(child.y - node.y);
      } else {
        // flex-grow > 0 → stretch to fill remaining primary-axis space.
        if ((child.flexGrow || 0) > 0) {
          (childNode as any).layoutGrow = 1;
        }
        // align-self → per-child counter-axis alignment.
        const alignSelf = (child.alignSelf || '').toLowerCase();
        if (alignSelf === 'stretch') {
          (childNode as any).layoutAlign = 'STRETCH';
        } else if (alignSelf === 'center') {
          (childNode as any).layoutAlign = 'CENTER';
        } else if (alignSelf === 'flex-end' || alignSelf === 'end') {
          (childNode as any).layoutAlign = 'MAX';
        } else if (alignSelf === 'flex-start' || alignSelf === 'start') {
          (childNode as any).layoutAlign = 'MIN';
        }
      }
    }

    if (i % 10 === 0) {
      const pct = 30 + Math.round((i / Math.max(children.length, 1)) * 60);
      sendProgress('Creating nodes… (' + (i + 1) + ')', Math.min(pct, 90));
    }
  }

  return frame;
}

// ─── Gradient Fill Builder ─────────────────────────────────────────────────

function buildGradientFill(gf: GradientFill, width: number, height: number): GradientPaint {
  const stops: ColorStop[] = gf.stops.map(function(s) {
    return {
      position: s.position,
      color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
    };
  });

  if (gf.type === 'RADIAL_GRADIENT') {
    return {
      type: 'GRADIENT_RADIAL',
      gradientStops: stops,
      gradientTransform: [[1, 0, 0], [0, 1, 0]],
      opacity: 1,
    } as GradientPaint;
  }

  // Linear gradient — convert CSS angle to Figma transform
  const angle = ((gf.angle || 180) - 90) * (Math.PI / 180);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    type: 'GRADIENT_LINEAR',
    gradientStops: stops,
    gradientTransform: [[cos, sin, 0.5 - (cos * 0.5 + sin * 0.5)], [-sin, cos, 0.5 - (-sin * 0.5 + cos * 0.5)]],
    opacity: 1,
  } as GradientPaint;
}

// ─── Text Node ────────────────────────────────────────────────────────────

async function buildTextNode(
  node: DesignNode,
  parentAbsX: number,
  parentAbsY: number,
  isAutoLayoutChild: boolean,
): Promise<TextNode> {
  const text = figma.createText();

  const family = node.fontFamily || 'Inter';
  const style  = node.fontStyle  || 'Regular';
  const resolvedFont = await tryLoadFont(family, style);

  text.fontName   = resolvedFont;
  text.fontSize   = Math.max(1, Math.round(node.fontSize || 14));
  text.characters = node.characters || '';

  if (node.textColor) {
    text.fills = [{
      type: 'SOLID',
      color: { r: node.textColor.r, g: node.textColor.g, b: node.textColor.b },
      opacity: node.textColor.a,
    }];
  }

  if (node.lineHeightPx && node.lineHeightPx > 0) {
    text.lineHeight = { value: node.lineHeightPx, unit: 'PIXELS' };
  }

  if (node.letterSpacing) {
    text.letterSpacing = { value: node.letterSpacing, unit: 'PIXELS' };
  }

  if (node.textAlignHorizontal) {
    text.textAlignHorizontal = node.textAlignHorizontal;
  }

  // Text decoration
  if (node.textDecoration === 'UNDERLINE') {
    text.textDecoration = 'UNDERLINE';
  } else if (node.textDecoration === 'STRIKETHROUGH') {
    text.textDecoration = 'STRIKETHROUGH';
  }

  text.name = sanitizeName(node.name);
  // Button/link text nodes (named with -txt suffix) get WIDTH_AND_HEIGHT so Figma
  // sizes the box from the glyphs up — prevents wrapping from any measurement drift.
  if (node.name.endsWith('-txt')) {
    text.textAutoResize = 'WIDTH_AND_HEIGHT';
  } else {
    // +2px flat buffer prevents premature wrapping from minor font-metric differences.
    text.resize(Math.max(node.width + 2, 1), Math.max(node.height, 1));
    text.textAutoResize = 'HEIGHT';
  }

  if (!isAutoLayoutChild) {
    text.x = Math.round(node.x - parentAbsX);
    text.y = Math.round(node.y - parentAbsY);
  }

  if (node.opacity !== undefined && node.opacity < 1) {
    text.opacity = node.opacity;
  }

  return text;
}

// ─── Image Node ───────────────────────────────────────────────────────────

function buildImageNode(
  node: DesignNode,
  parentAbsX: number,
  parentAbsY: number,
  isAutoLayoutChild: boolean,
): RectangleNode {
  const rect = figma.createRectangle();
  rect.name = sanitizeName(node.name);
  rect.resize(Math.max(node.width, 1), Math.max(node.height, 1));

  if (!isAutoLayoutChild) {
    rect.x = Math.round(node.x - parentAbsX);
    rect.y = Math.round(node.y - parentAbsY);
  }

  if (node.imageData) {
    try {
      const bytes = base64ToUint8Array(node.imageData);
      const img   = figma.createImage(bytes);
      rect.fills  = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }];
    } catch (e) {
      rect.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }];
    }
  } else {
    rect.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }];
  }

  if (node.opacity !== undefined && node.opacity < 1) {
    rect.opacity = node.opacity;
  }

  return rect;
}

// ─── Placeholder Text (non-editable) ─────────────────────────────────────

function buildPlaceholderText(
  node: DesignNode,
  parentAbsX: number,
  parentAbsY: number,
  isAutoLayoutChild: boolean,
): RectangleNode {
  const rect = figma.createRectangle();
  rect.name = sanitizeName(node.name);
  rect.resize(Math.max(node.width, 1), Math.max(node.height, 1));
  if (!isAutoLayoutChild) {
    rect.x = Math.round(node.x - parentAbsX);
    rect.y = Math.round(node.y - parentAbsY);
  }
  const c = node.textColor || { r: 0.1, g: 0.1, b: 0.1, a: 1 };
  rect.fills = [{ type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: 0.15 }];
  return rect;
}

// ─── Blend Mode ───────────────────────────────────────────────────────────

function cssBlendToFigma(css: string): BlendMode {
  const map: Record<string, BlendMode> = {
    'multiply':    'MULTIPLY',
    'screen':      'SCREEN',
    'overlay':     'OVERLAY',
    'darken':      'DARKEN',
    'lighten':     'LIGHTEN',
    'color-dodge': 'COLOR_DODGE',
    'color-burn':  'COLOR_BURN',
    'hard-light':  'HARD_LIGHT',
    'soft-light':  'SOFT_LIGHT',
    'difference':  'DIFFERENCE',
    'exclusion':   'EXCLUSION',
    'hue':         'HUE',
    'saturation':  'SATURATION',
    'color':       'COLOR',
    'luminosity':  'LUMINOSITY',
  };
  return map[css.toLowerCase()] || 'NORMAL';
}

// ─── Utilities ────────────────────────────────────────────────────────────

function sendProgress(message: string, percent: number) {
  figma.ui.postMessage({ type: 'progress', message: message, percent: percent });
}

function sanitizeName(name: string): string {
  return (name || '').replace(/[<>]/g, '').slice(0, 80) || 'layer';
}

function base64ToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.indexOf(',') !== -1 ? dataUrl.split(',')[1] : dataUrl;
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
