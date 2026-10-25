import { LifeCycleWatcher } from '@editor/runtime';
import { GfxControllerIdentifier } from '@editor/runtime/gfx';

export class EdgelessLocker extends LifeCycleWatcher {
  static override key = 'edgeless-locker';

  override mounted() {
    const { viewport } = this.std.get(GfxControllerIdentifier);
    viewport.locked = true;
  }
}
