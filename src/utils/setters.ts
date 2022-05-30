
/* IMPORT */

import {SYMBOLS_DIRECTIVES, TEMPLATE_STATE} from '~/constants';
import useCleanup from '~/hooks/use_cleanup';
import useReaction from '~/hooks/use_reaction';
import useReadonly from '~/hooks/use_readonly';
import $ from '~/methods/S';
import {context} from '~/oby';
import {createText, createComment} from '~/utils/creators';
import diff from '~/utils/diff';
import FragmentUtils from '~/utils/fragment';
import {castArray, flatten, isArray, isFunction, isNil, isPrimitive, isString, isSVG, isTemplateAccessor} from '~/utils/lang';
import {resolveChild, resolveFunction, resolveObservable} from '~/utils/resolvers';
import type {Child, DirectiveFunction, EventListener, Fragment, FunctionMaybe, ObservableMaybe, Ref, TemplateActionProxy} from '~/types';

/* MAIN */

const setAttributeStatic = (() => {

  const attributeCamelCasedRe = /e(r[HRWrv]|[Vawy])|Con|l(e[Tcs]|c)|s(eP|y)|a(t[rt]|u|v)|Of|Ex|f[XYa]|gt|hR|d[Pg]|t[TXYd]|[UZq]/; //URL: https://regex101.com/r/I8Wm4S/1
  const attributesCache: Record<string, string> = {};
  const uppercaseRe = /[A-Z]/g;

  const normalizeKeySvg = ( key: string ): string => {

    return attributesCache[key] || ( attributesCache[key] = attributeCamelCasedRe.test ( key ) ? key : key.replace ( uppercaseRe, char => `-${char.toLowerCase ()}` ) );

  };

  return ( element: HTMLElement, key: string, value: null | undefined | boolean | number | string ): void => {

    key = ( key === 'className' ) ? 'class' : key;

    if ( isSVG ( element ) ) {

      key = ( key === 'xlinkHref' || key === 'xlink:href' ) ? 'href' : normalizeKeySvg ( key );

      element.setAttribute ( key, String ( value ) );

    } else {

      if ( isNil ( value ) ) {

        element.removeAttribute ( key );

      } else {

        value = ( value === true ) ? '' : String ( value );

        element.setAttribute ( key, value );

      }

    }

  };

})();

const setAttribute = ( element: HTMLElement, key: string, value: FunctionMaybe<null | undefined | boolean | number | string> ): void => {

  resolveFunction ( value, setAttributeStatic.bind ( undefined, element, key ) );

};

const setChildReplacementFunction = ( parent: HTMLElement, fragment: Fragment, child: (() => Child) ): void => {

  let valuePrev: Child | undefined;
  let valuePrimitive = false;

  useReaction ( () => {

    let valueNext = child ();

    while ( isFunction ( valueNext ) ) {

      valueNext = valueNext ();

    }

    if ( valuePrimitive && valuePrev === valueNext ) return; // Nothing actually changed, skipping

    setChildStatic ( parent, fragment, valueNext );

    valuePrev = valueNext;
    valuePrimitive = isPrimitive ( valueNext );

  });

};

const setChildReplacementText = ( child: string, childPrev: Node ): Node => {

  if ( childPrev.nodeType === 3 ) {

    childPrev.nodeValue = child;

    return childPrev;

  } else {

    const parent = childPrev.parentElement;

    if ( !parent ) throw new Error ( 'Invalid child replacement' );

    const textNode = createText ( child );

    parent.replaceChild ( textNode, childPrev );

    return textNode;

  }

};

const setChildReplacement = ( child: Child, childPrev: Node ): void => {

  const type = typeof child;

  if ( type === 'string' || type === 'number' || type === 'bigint' ) {

    setChildReplacementText ( String ( child ), childPrev );

  } else {

    const parent = childPrev.parentElement;

    if ( !parent ) throw new Error ( 'Invalid child replacement' );

    const fragment = FragmentUtils.make ();

    FragmentUtils.pushNode ( fragment, childPrev );

    if ( type === 'function' ) {

      setChildReplacementFunction ( parent, fragment, child as (() => Child) ); //TSC

    } else {

      setChild ( parent, child, fragment );

    }

  }

};

const setChildStatic = ( parent: HTMLElement, fragment: Fragment, child: Child ): void => {

  const prev = FragmentUtils.getChildren ( fragment );
  const prevIsArray = ( prev instanceof Array );
  const prevLength = prevIsArray ? prev.length : 1;
  const prevFirst = prevIsArray ? prev[0] : prev;
  const prevLast = prevIsArray ? prev[prevLength - 1] : prev;
  const prevSibling = prevLast?.nextSibling || null;

  if ( prevLength === 0 ) { // Fast path for appending a node the first time

    const type = typeof child;

    if ( type === 'string' || type === 'number' || type === 'bigint' ) {

      const textNode = createText ( child );

      parent.appendChild ( textNode );

      FragmentUtils.replaceWithNode ( fragment, textNode );

      return;

    } else if ( type === 'object' && child !== null && typeof ( child as Node ).nodeType === 'number' ) { //TSC

      const node = child as Node;

      parent.insertBefore ( node, null );

      FragmentUtils.replaceWithNode ( fragment, node );

      return;

    }

  }

  if ( prevLength === 1 ) { // Fast path for single text child

    const type = typeof child;

    if ( type === 'string' || type === 'number' || type === 'bigint' ) {

      const node = setChildReplacementText ( String ( child ), prevFirst );

      FragmentUtils.replaceWithNode ( fragment, node );

      return;

    }

  }

  const fragmentNext = FragmentUtils.make ();

  const children: Node[] = Array.isArray ( child ) ? flatten ( child ) : [child]; //TSC

  for ( let i = 0, l = children.length; i < l; i++ ) {

    const child = children[i];
    const type = typeof child;

    if ( type === 'string' || type === 'number' || type === 'bigint' ) {

      FragmentUtils.pushNode ( fragmentNext, createText ( child ) );

    } else if ( type === 'object' && child !== null && typeof child.nodeType === 'number' ) {

      FragmentUtils.pushNode ( fragmentNext, child );

    } else if ( type === 'function' ) {

      const fragment = FragmentUtils.make ();

      FragmentUtils.pushFragment ( fragmentNext, fragment );

      resolveChild ( child, setChildStatic.bind ( undefined, parent, fragment ) );

    }

  }

  let next = FragmentUtils.getChildren ( fragmentNext );
  let nextLength = fragmentNext.length;

  if ( nextLength === 0 && prevLength === 1 && prevFirst.nodeType === 8 ) { // It's a placeholder already, no need to replace it

    return;

  }

  if ( nextLength === 0 || ( prevLength === 1 && prevFirst.nodeType === 8 ) ) { // Fast path for removing all children and/or replacing the placeholder

    const {childNodes} = parent;

    if ( childNodes.length === prevLength ) { // Maybe this fragment doesn't handle all children but only a range of them, checking for that here

      if ( TEMPLATE_STATE.active ) {

        for ( let i = 0, l = childNodes.length; i < l; i++ ) {

          const node = childNodes[i];
          const recycle = node.recycle;

          if ( !recycle ) continue;

          recycle ( node );

        }

      }

      parent.textContent = '';

      if ( nextLength === 0 ) { // Placeholder, to keep the right spot in the array of children

        const placeholder = createComment ();

        FragmentUtils.pushNode ( fragmentNext, placeholder );

        if ( next !== fragmentNext.values ) {

          next = placeholder;
          nextLength += 1;

        }

      }

      if ( prevSibling ) {

        if ( next instanceof Array ) {

          for ( let i = 0, l = next.length; i < l; i++ ) {

            parent.insertBefore ( next[i], prevSibling );

          }

        } else {

          parent.insertBefore ( next, prevSibling );

        }

      } else {

        if ( next instanceof Array ) {

          for ( let i = 0, l = next.length; i < l; i++ ) {

            parent.append ( next[i] );

          }

        } else {

          parent.append ( next );

        }

      }

      FragmentUtils.replaceWithFragment ( fragment, fragmentNext );

      return;

    }

  }

  if ( nextLength === 0 ) { // Placeholder, to keep the right spot in the array of children

    const placeholder = createComment ();

    FragmentUtils.pushNode ( fragmentNext, placeholder );

    if ( next !== fragmentNext.values ) {

      next = placeholder;
      nextLength += 1;

    }

  }

  diff ( parent, prev, next, prevSibling );

  FragmentUtils.replaceWithFragment ( fragment, fragmentNext );

};

const setChild = ( parent: HTMLElement, child: Child, fragment: Fragment = FragmentUtils.make () ): void => {

  resolveChild ( child, setChildStatic.bind ( undefined, parent, fragment ) );

};

const setClassStatic = (() => {

  const whitespaceRe = /\s+/g;

  return ( element: HTMLElement, key: string, value: null | undefined | boolean ): void => {

    const keys = key.split ( whitespaceRe );

    if ( value ) {

      element.classList.add ( ...keys );

    } else {

      element.classList.remove ( ...keys );

    }

  };

})();

const setClass = ( element: HTMLElement, key: string, value: FunctionMaybe<null | undefined | boolean> ): void => {

  resolveFunction ( value, setClassStatic.bind ( undefined, element, key ) );

};

const setClassBooleanStatic = ( element: HTMLElement, value: boolean, key: null | undefined | boolean | string, keyPrev?: null | undefined | boolean | string ): void => {

  if ( keyPrev && keyPrev !== true ) {

    setClassStatic ( element, keyPrev, false );

  }

  if ( key && key !== true ) {

    setClassStatic ( element, key, value );

  }

};

const setClassBoolean = ( element: HTMLElement, value: boolean, key: FunctionMaybe<null | undefined | boolean | string> ): void => {

  resolveFunction ( key, setClassBooleanStatic.bind ( undefined, element, value ) );

};

const setClassesStatic = ( element: HTMLElement, object: null | undefined | string | FunctionMaybe<null | undefined | boolean | string>[] | Record<string, FunctionMaybe<null | undefined | boolean>>, objectPrev?: null | undefined | string | FunctionMaybe<null | undefined | boolean | string>[] | Record<string, FunctionMaybe<null | undefined | boolean>> ): void => {

  if ( isString ( object ) ) {

    if ( isSVG ( element ) ) {

      element.setAttribute ( 'class', object );

    } else {

      element.className = object;

    }

  } else {

    if ( objectPrev ) {

      if ( isString ( objectPrev ) ) {

        if ( objectPrev ) {

          if ( isSVG ( element ) ) {

            element.setAttribute ( 'class', '' );

          } else {

            element.className = '';

          }

        }

      } else if ( isArray ( objectPrev ) ) {

        for ( let i = 0, l = objectPrev.length; i < l; i++ ) {

          if ( !objectPrev[i] ) continue;

          setClassBoolean ( element, false, objectPrev[i] );

        }

      } else {

        for ( const key in objectPrev ) {

          if ( object && key in object ) continue;

          setClass ( element, key, false );

        }

      }

    }

    if ( isArray ( object ) ) {

      for ( let i = 0, l = object.length; i < l; i++ ) {

        if ( !object[i] ) continue;

        setClassBoolean ( element, true, object[i] );

      }

    } else {

      for ( const key in object ) {

        setClass ( element, key, object[key] );

      }

    }

  }

};

const setClasses = ( element: HTMLElement, object: FunctionMaybe<null | undefined | string | FunctionMaybe<null | undefined | boolean | string>[] | Record<string, FunctionMaybe<null | undefined | boolean>>> ): void => {

  resolveFunction ( object, setClassesStatic.bind ( undefined, element ) );

};

const setDirective = <T extends unknown[]> ( element: HTMLElement, directive: string, args: T ): void => {

  const symbol = SYMBOLS_DIRECTIVES[directive] || Symbol ();
  const fn = context<DirectiveFunction<T>> ( symbol );

  if ( !symbol || !fn ) throw new Error ( `Directive "${directive}" not found` );

  const ref = $<Element | undefined>();

  setRef ( element, value => ref ( value ) );

  fn ( useReadonly ( ref ), ...args );

};

const setEventStatic = (() => {

  //TODO: Maybe delegate more events: [onmousemove, onmouseout, onmouseover, onpointerdown, onpointermove, onpointerout, onpointerover, onpointerup, ontouchend, ontouchmove, ontouchstart]

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

  const delegatedEventsListening: Record<string, boolean> = {};

  const delegate = ( event: string ): void => {

    const key: string | undefined = delegatedEvents[event];

    if ( !key ) return;

    document.addEventListener ( event.slice ( 2 ), event => {

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

    });

  };

  return ( element: HTMLElement, event: string, value: null | undefined | EventListener ): void => {

    if ( event.endsWith ( 'capture' ) ) {

      const type = event.slice ( 2, -7 );
      const key = `_${event}`; //TODO: Doesn't this clash with regular delegated events?

      const valuePrev = element[key];

      if ( valuePrev ) element.removeEventListener ( type, valuePrev, { capture: true } );

      if ( value ) element.addEventListener ( type, value, { capture: true } );

      element[key] = value;

    } else if ( event in delegatedEvents ) {

      if ( !( event in delegatedEventsListening ) ) {

        delegatedEventsListening[event] = true;

        delegate ( event );

      }

      const delegated = delegatedEvents[event];

      if ( delegated in element ) {

        throw new Error ( `A delegated event handler for "${event}" already exists on this element` );

      } else {

        element[delegated] = value;

      }

    } else {

      element[event] = value;

    }

  };

})();

const setEvent = ( element: HTMLElement, event: string, value: ObservableMaybe<null | undefined | EventListener> ): void => {

  resolveObservable<EventListener | null | undefined> ( value, setEventStatic.bind ( undefined, element, event ) ); //TSC

};

const setHTMLStatic = ( element: HTMLElement, value: null | undefined | number | string ): void => {

  element.innerHTML = String ( isNil ( value ) ? '' : value );

};

const setHTML = ( element: HTMLElement, value: FunctionMaybe<{ __html: FunctionMaybe<null | undefined | number | string> }> ): void => {

  resolveFunction ( value, value => {

    resolveFunction ( value.__html, setHTMLStatic.bind ( undefined, element ) );

  });

};

const setPropertyStatic = ( element: HTMLElement, key: string, value: null | undefined | boolean | number | string ): void => {

  element[key] = value;

  if ( isNil ( value ) ) {

    setAttributeStatic ( element, key, null );

  }

};

const setProperty = ( element: HTMLElement, key: string, value: FunctionMaybe<null | undefined | boolean | number | string> ): void => {

  resolveFunction ( value, setPropertyStatic.bind ( undefined, element, key ) );

};

const setRef = <T> ( element: T, value: null | undefined | Ref<T> | Ref<T>[] ): void => { // Scheduling a microtask to dramatically increase the probability that the element will get connected to the DOM in the meantime, which would be more convenient

  if ( isNil ( value ) ) return;

  const values = castArray ( value );

  values.forEach ( value => queueMicrotask ( value.bind ( undefined, element ) ) );

  useCleanup ( () => values.forEach ( value => queueMicrotask ( value.bind ( undefined, undefined ) ) ) );

};

const setStyleStatic = (() => {

  const propertyNonDimensionalRe = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;

  return ( element: HTMLElement, key: string, value: null | undefined | number | string ): void => {

    if ( key.charCodeAt ( 0 ) === 45 ) { // /^-/

      element.style.setProperty ( key, String ( value ) );

    } else if ( isNil ( value ) ) {

      element.style[key] = null;

    } else {

      element.style[key] = ( isString ( value ) || propertyNonDimensionalRe.test ( key ) ? value : `${value}px` );

    }

  };

})();

const setStyle = ( element: HTMLElement, key: string, value: FunctionMaybe<null | undefined | number | string> ): void => {

  resolveFunction ( value, setStyleStatic.bind ( undefined, element, key ) );

};

const setStylesStatic = ( element: HTMLElement, object: null | undefined | string | Record<string, FunctionMaybe<null | undefined | number | string>>, objectPrev?: null | undefined | string | Record<string, FunctionMaybe<null | undefined | number | string>> ): void => {

  if ( isString ( object ) ) {

    element.setAttribute ( 'style', object );

  } else {

    if ( objectPrev ) {

      if ( isString ( objectPrev ) ) {

        if ( objectPrev ) {

          element.style.cssText = '';

        }

      } else {

        for ( const key in objectPrev ) {

          if ( object && key in object ) continue;

          setStyleStatic ( element, key, null );

        }

      }

    }

    for ( const key in object ) {

      setStyle ( element, key, object[key] );

    }

  }

};

const setStyles = ( element: HTMLElement, object: FunctionMaybe<null | undefined | string | Record<string, FunctionMaybe<null | undefined | number | string>>> ): void => {

  resolveFunction ( object, setStylesStatic.bind ( undefined, element ) );

};

const setTemplateAccessor = ( element: HTMLElement, key: string, value: TemplateActionProxy ): void => {

  if ( key === 'children' ) {

    const placeholder = createText ( '' ); // Using a Text node rather than a Comment as the former may be what we actually want ultimately

    element.insertBefore ( placeholder, null );

    value ( element, 'setChildReplacement', undefined, placeholder );

  } else if ( key === 'ref' ) {

    value ( element, 'setRef' );

  } else if ( key === 'style' ) {

    value ( element, 'setStyles' );

  } else if ( key === 'class' ) {

    if ( !isSVG ( element ) ) {

      element.className = ''; // Ensuring the attribute is present

    }

    value ( element, 'setClasses' );

  } else if ( key === 'innerHTML' || key === 'outerHTML' || key === 'textContent' ) {

    // Forbidden props

  } else if ( key === 'dangerouslySetInnerHTML' ) {

    value ( element, 'setHTML' );

  } else if ( key.charCodeAt ( 0 ) === 111 && key.charCodeAt ( 1 ) === 110 ) { // /^on/

    value ( element, 'setEvent', key.toLowerCase () );

  } else if ( key.charCodeAt ( 0 ) === 117 && key.charCodeAt ( 3 ) === 58 ) { // /^u..:/

    value ( element, 'setDirective', key.slice ( 4 ) );

  } else if ( key in element && !isSVG ( element ) ) {

    if ( key === 'className' ) { // Ensuring the attribute is present

      element.className = '';

    }

    value ( element, 'setProperty', key );

  } else {

    element.setAttribute ( key, '' ); // Ensuring the attribute is present

    value ( element, 'setAttribute', key );

  }

};

const setProp = ( element: HTMLElement, key: string, value: any ): void => {

  if ( isTemplateAccessor ( value ) ) {

    setTemplateAccessor ( element, key, value );

  } else if ( key === 'children' ) {

    setChild ( element, value );

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

  } else if ( key.charCodeAt ( 0 ) === 111 && key.charCodeAt ( 1 ) === 110 ) { // /^on/

    setEvent ( element, key.toLowerCase (), value );

  } else if ( key.charCodeAt ( 0 ) === 117 && key.charCodeAt ( 3 ) === 58 ) { // /^u..:/

    setDirective ( element, key.slice ( 4 ), value );

  } else if ( key in element && !isSVG ( element ) ) {

    setProperty ( element, key, value );

  } else {

    setAttribute ( element, key, value );

  }

};

const setProps = ( element: HTMLElement, object: Record<string, unknown> ): void => {

  for ( const key in object ) {

    setProp ( element, key, object[key] );

  }

};

/* EXPORT */

export {setAttributeStatic, setAttribute, setChildReplacementFunction, setChildReplacementText, setChildReplacement, setChildStatic, setChild, setClassStatic, setClass, setClassesStatic, setClasses, setEventStatic, setEvent, setHTMLStatic, setHTML, setPropertyStatic, setProperty, setRef, setStyleStatic, setStyle, setStylesStatic, setStyles, setTemplateAccessor, setProp, setProps};
