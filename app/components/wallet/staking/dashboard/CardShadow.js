// @flow
import React, { Component } from 'react';
import { observer } from 'mobx-react';
import type { Node } from 'react';

import styles from './CardShadow.scss';

type Props = {|
  children?: Node,
  title?: string,
|};

@observer
export default class Card extends Component<Props> {

  static defaultProps: {|children: void, title: void|} = {
    children: undefined,
    title: undefined,
  };

  render(): Node {
    const { title, children } = this.props;
    return (
      <div className={styles.wrapper}>
        {title !== undefined &&
          <h2 className={styles.title}>
            {title}
          </h2>
        }
        <div className={styles.inner}>
          {children}
        </div>
      </div>
    );
  }
}