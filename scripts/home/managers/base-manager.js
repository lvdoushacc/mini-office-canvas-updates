/**
 * BaseManager 提供子模块与 App 主控制器的无缝代理与状态双向访问
 */
export class BaseManager {
  constructor(app) {
    this.app = app;
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in target) {
          const val = Reflect.get(target, prop, receiver);
          return typeof val === 'function' ? val.bind(receiver) : val;
        }
        const appVal = target.app?.[prop];
        return typeof appVal === 'function' ? appVal.bind(target.app) : appVal;
      },
      set(target, prop, value) {
        if (prop in target) {
          return Reflect.set(target, prop, value);
        }
        if (target.app) {
          target.app[prop] = value;
          return true;
        }
        return Reflect.set(target, prop, value);
      }
    });
  }
}
