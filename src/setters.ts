
/* IMPORT */

import type {Child, ChildMounted, ChildPrepared, ChildResolved, EventListener, ObservableResolver, Ref} from './types';
import useEffect from './hooks/use_effect';
import {castArray, isArray, isBoolean, isFunction, isNil, isNode, isObservable, isString, isTemplateActionProxy, keys} from './utils';

//TODO: Support functions as values that get wrapped in an automatic effect

/* HELPERS */ //TODO: These functions should be reduced as much as possible

const normalizeChildren = ( children: Child[] ): Child[] => {

  // It flattes the array and removes nil and boolean values, quickly

  for ( let i = children.length - 1; i >= 0; i-- ) {

    const child = children[i];

    if ( isNil ( child ) || isBoolean ( child ) ) {

      children.splice ( i, 1 );

    } else if ( isArray ( child ) ) {

      for ( let ci = child.length -1; ci >= 0; ci-- ) {

        const childChild = child[ci];

        if ( isNil ( childChild ) || isBoolean ( childChild ) ) {

          child.splice ( ci, 1 );

        }

      }

      children.splice ( i, 1, ...child );

    }

  }

  return children;

};

const prepareChildren = ( children: Child[] ): ChildPrepared => {

  children = normalizeChildren ( children );

  if ( children.length === 0 ) return null;

  if ( children.length === 1 ) return prepareChild ( children[0] );

  const childrenPrepared: ChildPrepared = new Array ( children.length );

  for ( let i = children.length - 1; i >= 0; i-- ) {

    childrenPrepared[i] = prepareChild ( children[i] );

  }

  return childrenPrepared;

};

const prepareChild = ( child: Child ): ChildPrepared => {

  if ( isNil ( child ) ) return null;

  if ( isBoolean ( child ) ) return null;

  if ( isNode ( child ) ) return child;

  if ( isFunction ( child ) ) return child;

  if ( isArray ( child ) ) {

    if ( child.length === 0 ) return null;

    if ( child.length === 1 ) return prepareChild ( child[0] );

    return prepareChildren ( child );

  }

  return String ( child );

};

const resolveChild = ( child: Child ): ChildResolved => {

  if ( isFunction ( child ) ) return resolveChild ( child () );

  if ( isArray ( child ) ) {

    const childResolved: ChildResolved[] = new Array ( child.length );

    for ( let i = 0, l = child.length; i < l; i++ ) {

      childResolved[i] = resolveChild ( child[i] );

    }

    return childResolved;

  }

  return child;

};

const removeChildren = ( parent: HTMLElement, children: ChildMounted ): void => {

  if ( parent.childNodes.length === children.length ) {

    parent.textContent = '';

  } else {

    for ( let i = 0, l = children.length; i < l; i++ ) {

      const child = children[i];

      if ( isArray ( child ) ) {

        removeChildren ( parent, child );

      } else if ( isNode ( child ) ) {

        parent.removeChild ( child );

      }

    }

  }

};

const getChildrenNextSibling = ( children: ChildMounted ): Node | null | undefined => {

  for ( let i = children.length - 1; i >= 0; i-- ) {

    const child = children[i];

    if ( isArray ( child ) ) {

      const nextSibling = getChildrenNextSibling ( child );

      if ( nextSibling !== undefined ) return nextSibling;

    } else {

      return child.nextSibling;

    }

  }

};

/* MAIN */

const setAbstract = <T> ( value: ObservableResolver<T>, setter: (( value: T, valuePrev?: T ) => void), resolveFunctions: boolean = false ): void => {

  if ( isObservable ( value ) ) {

    let valuePrev: T | undefined;

    useEffect ( () => {

      const valueNext = value ();

      if ( isObservable ( valueNext ) ) {

        setAbstract ( valueNext, setter );

      } else {

        setter ( valueNext, valuePrev );

        valuePrev = valueNext;

      }

    });

  } else if ( resolveFunctions && isFunction ( value ) ) {

    setAbstract ( value (), setter ); //TODO: Should this be wrapped in a useEffect?

  } else {

    setter ( value );

  }

};

const setAttributeStatic = ( attributes: NamedNodeMap, key: string, value: null | undefined | boolean | number | string ): void => {

  const attr = attributes.getNamedItem ( key );

  if ( isNil ( value ) || isFunction ( value ) || value === false ) {

    if ( attr ) {

      attributes.removeNamedItem ( key );

    }

  } else {

    value = ( value === true ) ? '' : String ( value );

    if ( attr ) {

      attr.value = value;

    } else {

      const attr = document.createAttribute ( key );

      attr.value = value;

      attributes.setNamedItem ( attr );

    }

  }

};

const setAttribute = ( element: HTMLElement, key: string, value: ObservableResolver<null | undefined | boolean | number | string> ): void => {

  const {attributes} = element;

  setAbstract ( value, value => {

    setAttributeStatic ( attributes, key, value );

  });

};

const setChildReplacement = ( child: Child, childPrev: Node ): void => {

  const type = typeof child;

  if ( child === null || ( type !== 'object' && type !== 'function' ) ) {

    if ( child === null || child === undefined || type === 'boolean' ) {

      const parent = childPrev.parentElement;

      if ( !parent ) throw new Error ( 'Invalid child replacement' );

      parent.removeChild ( childPrev );

    } else {

      const text = ( type === 'string' ) ? ( child as string ) : String ( child ); //TSC

      if ( childPrev.nodeType === 3 ) {

        childPrev.nodeValue = text;

      } else {

        const parent = childPrev.parentElement;

        if ( !parent ) throw new Error ( 'Invalid child replacement' );

        const textNode = new Text ( text );

        parent.replaceChild ( textNode, childPrev );

      }

    }

  } else {

    const parent = childPrev.parentElement;

    if ( !parent ) throw new Error ( 'Invalid child replacement' );

    setChild ( parent, child, [childPrev] );

  }

};

const setChildStatic = ( parent: HTMLElement, child: Child, childrenPrev: ChildMounted, childrenPrevSibling: Node | null = null ): ChildMounted => {

  //TODO: Optimize this massively, after it works reliably, currently it may not quite work and it certainly has **terrible** performance
  //URL: https://github.com/adamhaile/surplus/blob/2aca5a36ceb6a7cbb4d609cd04ee631714602f91/src/runtime/content.ts
  //URL: https://github.com/adamhaile/surplus/blob/2aca5a36ceb6a7cbb4d609cd04ee631714602f91/src/runtime/insert.ts
  //URL: https://github.com/luwes/sinuous/blob/master/packages/sinuous/h/src/h.js
  //URL: https://github.com/ryansolid/dom-expressions/blob/main/packages/dom-expressions/src/client.js

  if ( !childrenPrev.length && ( isNil ( child ) || isBoolean ( child ) ) ) childrenPrev; // Nothing to mount

  const childrenNext = castArray ( ( isArray ( child ) ? prepareChildren ( child ) : prepareChild ( child ) ) ?? new Comment () );
  const childrenNextSibling = getChildrenNextSibling ( childrenPrev ) || childrenPrevSibling;

  removeChildren ( parent, childrenPrev );

  for ( let i = 0, l = childrenNext.length; i < l; i++ ) {

    const childNext = childrenNext[i];

    if ( isFunction ( childNext ) ) {

      let childrenPrev: ChildMounted = [];

      setAbstract ( childNext, childNext => {

        childrenNext[i] = childrenPrev = setChildStatic ( parent, childNext, childrenPrev, childrenNextSibling );

      }, true );

    } else if ( isString ( childNext ) ) {

      const textNode = new Text ( childNext );

      parent.insertBefore ( textNode, childrenNextSibling );

      childrenNext[i] = textNode;

    } else if ( isNode ( childNext ) ) {

      parent.insertBefore ( childNext, childrenNextSibling );

    }

  }

  return childrenNext as ChildMounted; //TSC

};

const setChild = ( parent: HTMLElement, child: Child, childrenPrev: ChildMounted = [], childrenPrevSibling: Node | null = null ): ChildMounted => {

  setAbstract ( child, child => {

    childrenPrev = setChildStatic ( parent, child, childrenPrev, childrenPrevSibling );

  });

  return childrenPrev;

};

const setChildren = ( parent: HTMLElement, children: Child | Child[] ): void => {

  if ( isArray ( children ) ) {

    for ( let i = 0, l = children.length; i < l; i++ ) {

      setChild ( parent, children[i] );

    }

  } else {

    setChild ( parent, children );

  }

};

const setClassStatic = ( classList: DOMTokenList, key: string, value: null | undefined | boolean ): void => {

  classList.toggle ( key, !!value );

};

const setClass = ( classList: DOMTokenList, key: string, value: ObservableResolver<null | undefined | boolean> ): void => {

  setAbstract ( value, value => {

    setClassStatic ( classList, key, value );

  });

};

const setClassesStatic = ( element: HTMLElement, object: string | Record<string, ObservableResolver<null | undefined | boolean>>, objectPrev?: string | Record<string, ObservableResolver<null | undefined | boolean>> ): void => {

  if ( isString ( object ) ) {

    element.className = object;

  } else {

    const {classList} = element;

    if ( objectPrev ) {

      if ( isString ( objectPrev ) ) {

        element.className = '';

      } else {

        for ( const key in objectPrev ) {

          if ( key in object ) continue;

          setClass ( classList, key, false );

        }

      }

    }

    for ( const key in object ) {

      setClass ( classList, key, object[key] );

    }

  }

};

const setClasses = ( element: HTMLElement, object: ObservableResolver<string | Record<string, ObservableResolver<null | undefined | boolean>>> ): void => {

  setAbstract ( object, ( object, objectPrev ) => {

    setClassesStatic ( element, object, objectPrev );

  });

};

const setEventStatic = (() => {

  //TODO: Maybe delegate more events (on demand?): [onmousemove, onmouseout, onmouseover, onpointerdown, onpointermove, onpointerout, onpointerover, onpointerup, ontouchend, ontouchmove, ontouchstart]

  const delegatedEvents = <const> {
    onbeforeinput: '_onbeforeinput',
    onclick: '_onclick',
    ondblclick: '_ondblclick',
    onfocusin: '_onfocusin',
    onfocusout: '_onfocusout',
    oninput: '_oninput',
    onkeydown: '_onkeydown',
    onkeyup: '_onkeyup',
    onmousedown: '_onmousedown',
    onmouseup: '_onmouseup'
  };

  for ( const event of keys ( delegatedEvents ) ) {

    const key = delegatedEvents[event];

    document[event] = ( event: Event ): void => {

      const targets = event.composedPath ();
      const target = targets[0] || document;

      Object.defineProperty ( event, 'currentTarget', {
        configurable: true,
        get () {
          return target;
        }
      });

      for ( let i = 0, l = targets.length; i < l; i++ ) {

        const handler = targets[i][key];

        if ( !handler ) continue;

        handler ( event );

        if ( event.cancelBubble ) break;

      }

    };

  }

  return ( element: HTMLElement, event: string, value: null | undefined | EventListener ): void => {

    if ( event.endsWith ( 'capture' ) ) {

      const type = event.slice ( 2, -7 );
      const key = `_${event}`;

      const valuePrev = element[key];

      if ( valuePrev ) element.removeEventListener ( type, valuePrev, { capture: true } );

      if ( value ) element.addEventListener ( type, value, { capture: true } );

      element[key] = value;

    } else {

      const key: string = delegatedEvents[event] || event;

      element[key] = value;

    }

  };

})();

const setEvent = ( element: HTMLElement, event: string, value: ObservableResolver<null | undefined | EventListener> ): void => {

  setAbstract ( value, value => {

    setEventStatic ( element, event, value );

  });

};

const setHTMLStatic = ( element: HTMLElement, value: null | undefined | number | string ): void => {

  element.innerHTML = String ( value ?? '' );

};

const setHTML = ( element: HTMLElement, value: ObservableResolver<{ __html: ObservableResolver<null | undefined | number | string> }> ): void => {

  setAbstract ( value, value => {

    setAbstract ( value.__html, html => {

      setHTMLStatic ( element, html );

    });

  });

};

const setPropertyStatic = ( element: HTMLElement, key: string, value: null | undefined | boolean | number | string ): void => {

  value = ( key === 'className' ) ? ( value ?? '' ) : value;

  element[key] = value;

};

const setProperty = ( element: HTMLElement, key: string, value: ObservableResolver<null | undefined | boolean | number | string> ): void => {

  setAbstract ( value, value => {

    setPropertyStatic ( element, key, value );

  });

};

const setRef = <T> ( element: T, value?: Ref<T> ): void => {

  if ( isNil ( value ) ) return;

  if ( !isFunction ( value ) ) throw new Error ( 'Invalid ref' );

  queueMicrotask ( () => { // Scheduling a microtask to dramatically increase the probability that the element gets mounted in the meantime, which would be more convenient

    value ( element );

  });

};

const setStyleStatic = (() => {

  const propertyNonDimensionalRe = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i

  return ( style: CSSStyleDeclaration, key: string, value: null | undefined | number | string ): void => {

    if ( key.charCodeAt ( 0 ) === 45 ) { // /^-/

      style.setProperty ( key, String ( value ) );

    } else if ( isNil ( value ) ) {

      style[key] = null;

    } else {

      style[key] = ( isString ( value ) || propertyNonDimensionalRe.test ( key ) ? value : `${value}px` );

    }

  };

})();

const setStyle = ( style: CSSStyleDeclaration, key: string, value: ObservableResolver<null | undefined | number | string> ): void => {

  setAbstract ( value, value => {

    setStyleStatic ( style, key, value );

  });

};

const setStylesStatic = ( style: CSSStyleDeclaration, object: string | Record<string, ObservableResolver<null | undefined | number | string>>, objectPrev?: string | Record<string, ObservableResolver<null | undefined | number | string>> ): void => {

  if ( isString ( object ) ) {

    style.cssText = object;

  } else {

    if ( objectPrev ) {

      if ( isString ( objectPrev ) ) {

        style.cssText = '';

      } else {

        for ( const key in objectPrev ) {

          if ( key in object ) continue;

          setStyleStatic ( style, key, null );

        }

      }

    }

    for ( const key in object ) {

      setStyle ( style, key, object[key] );

    }

  }

};

const setStyles = ( element: HTMLElement, object: ObservableResolver<string | Record<string, ObservableResolver<null | undefined | number | string>>> ): void => {

  const {style} = element;

  setAbstract ( object, ( object, objectPrev ) => {

    setStylesStatic ( style, object, objectPrev );

  });

};

const setProp = ( element: HTMLElement, key: string, value: any ): void => {

  if ( isTemplateActionProxy ( value ) ) {

    if ( key === 'children' ) {

      const placeholder = new Text ();

      element.insertBefore ( placeholder, null );

      value ( element, 'child', placeholder );

    } else {

      value ( element, key );

    }

  } else if ( key === 'children' ) {

    setChildren ( element, value );

  } else if ( key === 'ref' ) {

    setRef ( element, value );

  } else if ( key === 'style' ) {

    setStyles ( element, value );

  } else if ( key === 'class' ) {

    setClasses ( element, value );

  } else if ( key === 'innerHTML' || key === 'outerHTML' || key === 'textContent' ) {

    // Forbidden props

  } else if ( key === 'dangerouslySetInnerHTML' ) {

    setHTML ( element, value );

  } else if ( ( key.charCodeAt ( 0 ) === 111 || key.charCodeAt ( 0 ) === 79 ) && ( key.charCodeAt ( 1 ) === 110 || key.charCodeAt ( 1 ) === 78 ) ) { // /^on/i

    setEvent ( element, key.toLowerCase (), value );

  } else if ( key in element ) {

    setProperty ( element, key, value );

  } else {

    setAttribute ( element, key, value );

  }

};

const setProps = ( element: HTMLElement, object: Record<string, any> ): void => {

  for ( const key in object ) {

    setProp ( element, key, object[key] );

  }

};

/* EXPORT */

export {resolveChild, setAbstract, setAttributeStatic, setAttribute, setChildReplacement, setChildStatic, setChild, setChildren, setClassStatic, setClass, setClassesStatic, setClasses, setEventStatic, setEvent, setHTMLStatic, setHTML, setPropertyStatic, setProperty, setRef, setStyleStatic, setStyle, setStylesStatic, setStyles, setProp, setProps};
