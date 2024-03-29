///
/// Copyright © 2016-2024 The Thingsboard Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///

import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, ViewChild } from '@angular/core';
import { PageComponent } from '@shared/components/page.component';
import { Store } from '@ngrx/store';
import { AppState } from '@core/core.state';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { FcRuleNode, RuleNodeType } from '@shared/models/rule-node.models';
import { EntityType } from '@shared/models/entity-type.models';
import { Subscription } from 'rxjs';
import { RuleNodeConfigComponent } from './rule-node-config.component';
import { Router } from '@angular/router';
import { RuleChainType } from '@app/shared/models/rule-chain.models';
import { ComponentClusteringMode } from '@shared/models/component-descriptor.models';
import { coerceBoolean } from '@shared/decorators/coercion';

@Component({
  selector: 'tb-rule-node',
  templateUrl: './rule-node-details.component.html',
  styleUrls: ['./rule-node-details.component.scss']
})
export class RuleNodeDetailsComponent extends PageComponent implements OnInit, OnChanges {

  @ViewChild('ruleNodeConfigComponent') ruleNodeConfigComponent: RuleNodeConfigComponent;

  @Input()
  ruleNode: FcRuleNode;

  @Input()
  ruleChainId: string;

  @Input()
  ruleChainType: RuleChainType;

  @Input()
  @coerceBoolean()
  disabled = false;

  @Input()
  @coerceBoolean()
  isAdd = false;

  @Output()
  initRuleNode = new EventEmitter<void>();

  @Output()
  changeScript = new EventEmitter<void>();

  ruleNodeType = RuleNodeType;
  entityType = EntityType;

  ruleNodeFormGroup: UntypedFormGroup;

  private ruleNodeFormSubscription: Subscription;

  constructor(protected store: Store<AppState>,
              private fb: UntypedFormBuilder,
              private router: Router) {
    super(store);
    this.ruleNodeFormGroup = this.fb.group({});
  }

  private buildForm() {
    if (this.ruleNodeFormSubscription) {
      this.ruleNodeFormSubscription.unsubscribe();
      this.ruleNodeFormSubscription = null;
    }
    if (this.ruleNode) {
      this.ruleNodeFormGroup = this.fb.group({
        name: [this.ruleNode.name, [Validators.required, Validators.pattern('(.|\\s)*\\S(.|\\s)*'), Validators.maxLength(255)]],
        debugMode: [this.ruleNode.debugMode, []],
        singletonMode: [this.ruleNode.singletonMode, []],
        configuration: [this.ruleNode.configuration, [Validators.required]],
        additionalInfo: this.fb.group(
          {
            description: [this.ruleNode.additionalInfo ? this.ruleNode.additionalInfo.description : ''],
          }
        )
      });
      this.ruleNodeFormSubscription = this.ruleNodeFormGroup.valueChanges.subscribe(() => {
        this.updateRuleNode();
      });
    } else {
      this.ruleNodeFormGroup = this.fb.group({});
    }
    if (this.disabled) {
      this.ruleNodeFormGroup.disable({emitEvent: false});
    }
  }

  private updateRuleNode() {
    const formValue = this.ruleNodeFormGroup.value || {};
    formValue.name = formValue.name.trim();
    Object.assign(this.ruleNode, formValue);
  }

  ngOnInit(): void {
    if (this.disabled) {
      this.ruleNodeFormGroup.disable({emitEvent: false});
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    for (const propName of Object.keys(changes)) {
      const change = changes[propName];
      if (change.currentValue !== change.previousValue) {
        if (propName === 'ruleNode') {
          this.buildForm();
        }
      }
    }
  }

  validate() {
    this.ruleNodeConfigComponent.validate();
  }

  openRuleChain($event: Event) {
    if ($event) {
      $event.stopPropagation();
    }
    const ruleChainId = this.ruleNodeFormGroup.get('configuration')?.value?.ruleChainId;
    if (ruleChainId) {
      if (this.ruleChainType === RuleChainType.EDGE) {
        this.router.navigateByUrl(`/edgeManagement/ruleChains/${ruleChainId}`);
      } else {
        this.router.navigateByUrl(`/ruleChains/${ruleChainId}`);
      }
    }
  }

  isSingletonEditAllowed() {
    return this.ruleNode.component.clusteringMode === ComponentClusteringMode.USER_PREFERENCE;
  }
}
