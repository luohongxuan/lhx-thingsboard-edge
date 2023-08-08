///
/// Copyright © 2016-2023 The Thingsboard Authors
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

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../../../src/typings/rawloader.typings.d.ts" />

import { ElementRef, Inject, Injectable, NgZone } from '@angular/core';
import { WINDOW } from '@core/services/window.service';
import { ExceptionData } from '@app/shared/models/error.models';
import {
  base64toObj,
  base64toString,
  baseUrl,
  createLabelFromDatasource,
  deepClone,
  deleteNullProperties,
  guid,
  hashCode,
  isDefined,
  isDefinedAndNotNull,
  isString,
  isUndefined,
  objToBase64,
  objToBase64URI
} from '@core/utils';
import { WindowMessage } from '@shared/models/window-message.model';
import { TranslateService } from '@ngx-translate/core';
import { customTranslationsPrefix, i18nPrefix } from '@app/shared/models/constants';
import { DataKey, Datasource, DatasourceType, KeyInfo } from '@shared/models/widget.models';
import { DataKeyType } from '@app/shared/models/telemetry/telemetry.models';
import { alarmFields, alarmSeverityTranslations, alarmStatusTranslations } from '@shared/models/alarm.models';
import { materialColors } from '@app/shared/models/material.models';
import { WidgetInfo } from '@home/models/widget-component.models';
import jsonSchemaDefaults from 'json-schema-defaults';
import { fromEvent, Observable, Subscription } from 'rxjs';
import { publishReplay, refCount } from 'rxjs/operators';
import { WidgetContext } from '@app/modules/home/models/widget-component.models';
import {
  AttributeData,
  LatestTelemetry,
  TelemetrySubscriber,
  TelemetryType
} from '@shared/models/telemetry/telemetry.models';
import { EntityId } from '@shared/models/id/entity-id';
import { DatePipe } from '@angular/common';
import { entityTypeTranslations } from '@shared/models/entity-type.models';
import { OverlayRef } from '@angular/cdk/overlay';
import { ResizeObserver } from '@juggle/resize-observer';

const i18nRegExp = new RegExp(`{${i18nPrefix}:[^{}]+}`, 'g');

const predefinedFunctions: { [func: string]: string } = {
  Sin: 'return Math.round(1000*Math.sin(time/5000));',
  Cos: 'return Math.round(1000*Math.cos(time/5000));',
  Random: 'var value = prevValue + Math.random() * 100 - 50;\n' +
    'var multiplier = Math.pow(10, 2 || 0);\n' +
    'var value = Math.round(value * multiplier) / multiplier;\n' +
    'if (value < -1000) {\n' +
    '	value = -1000;\n' +
    '} else if (value > 1000) {\n' +
    '	value = 1000;\n' +
    '}\n' +
    'return value;'
};

const predefinedFunctionsList: Array<string> = [];
for (const func of Object.keys(predefinedFunctions)) {
  predefinedFunctionsList.push(func);
}

const defaultAlarmFields: Array<string> = [
  alarmFields.createdTime.keyName,
  alarmFields.originator.keyName,
  alarmFields.type.keyName,
  alarmFields.severity.keyName,
  alarmFields.status.keyName
];

// @dynamic
@Injectable({
  providedIn: 'root'
})
export class UtilsService {

  iframeMode = false;
  widgetEditMode = false;
  editWidgetInfo: WidgetInfo = null;

  defaultDataKey: DataKey = {
    name: 'f(x)',
    type: DataKeyType.function,
    label: 'Sin',
    color: this.getMaterialColor(0),
    funcBody: this.getPredefinedFunctionBody('Sin'),
    settings: {},
    _hash: Math.random()
  };

  defaultDatasource: Datasource = {
    type: DatasourceType.function,
    name: DatasourceType.function,
    dataKeys: [deepClone(this.defaultDataKey)]
  };

  defaultAlarmDataKeys: Array<DataKey> = [];

  constructor(@Inject(WINDOW) private window: Window,
              private zone: NgZone,
              private datePipe: DatePipe,
              private translate: TranslateService) {
    let frame: Element = null;
    try {
      frame = window.frameElement;
    } catch (e) {
      // ie11 fix
    }
    if (frame) {
      this.iframeMode = true;
      const dataWidgetAttr = frame.getAttribute('data-widget');
      if (dataWidgetAttr && dataWidgetAttr.length) {
        this.editWidgetInfo = JSON.parse(dataWidgetAttr);
        this.widgetEditMode = true;
      }
    }
  }

  public getPredefinedFunctionsList(): Array<string> {
    return predefinedFunctionsList;
  }

  public getPredefinedFunctionBody(func: string): string {
    return predefinedFunctions[func];
  }

  public getDefaultDatasource(dataKeySchema: any): Datasource {
    const datasource = deepClone(this.defaultDatasource);
    if (isDefined(dataKeySchema)) {
      datasource.dataKeys[0].settings = this.generateObjectFromJsonSchema(dataKeySchema);
    }
    return datasource;
  }

  private initDefaultAlarmDataKeys() {
    for (let i = 0; i < defaultAlarmFields.length; i++) {
      const name = defaultAlarmFields[i];
      const dataKey: DataKey = {
        name,
        type: DataKeyType.alarm,
        label: this.translate.instant(alarmFields[name].name),
        color: this.getMaterialColor(i),
        settings: {},
        _hash: Math.random()
      };
      this.defaultAlarmDataKeys.push(dataKey);
    }
  }

  public getDefaultAlarmDataKeys(): Array<DataKey> {
    if (!this.defaultAlarmDataKeys.length) {
      this.initDefaultAlarmDataKeys();
    }
    return deepClone(this.defaultAlarmDataKeys);
  }

  public defaultAlarmFieldContent(key: DataKey | {name: string}, value: any): string {
    if (isDefined(value)) {
      const alarmField = alarmFields[key.name];
      if (alarmField) {
        if (alarmField.time) {
          return value ? this.datePipe.transform(value, 'yyyy-MM-dd HH:mm:ss') : '';
        } else if (alarmField === alarmFields.severity) {
          return this.translate.instant(alarmSeverityTranslations.get(value));
        } else if (alarmField === alarmFields.status) {
          return alarmStatusTranslations.get(value) ? this.translate.instant(alarmStatusTranslations.get(value)) : value;
        } else if (alarmField === alarmFields.originatorType) {
          return this.translate.instant(entityTypeTranslations.get(value).type);
        } else if (alarmField.value === alarmFields.assignee.value) {
          return '';
        }
      }
      return value;
    }
    return '';
  }

  public generateObjectFromJsonSchema(schema: any): any {
    const obj = jsonSchemaDefaults(schema);
    deleteNullProperties(obj);
    return obj;
  }

  public processWidgetException(exception: any): ExceptionData {
    const data = this.parseException(exception, -6);
    if (data.message?.startsWith('NG0')) {
       data.message = `${this.translate.instant('widget.widget-template-error')}<br/>
                       <br/><i>${this.translate.instant('dialog.error-message-title')}</i><br/><br/>${data.message}`;
    }
    if (this.widgetEditMode) {
      const message: WindowMessage = {
        type: 'widgetException',
        data
      };
      this.window.parent.postMessage(JSON.stringify(message), '*');
    }
    return data;
  }

  public parseException(exception: any, lineOffset?: number): ExceptionData {
    const data: ExceptionData = {};
    if (exception) {
      if (typeof exception === 'string') {
        data.message = exception;
      } else if (exception instanceof String) {
        data.message = exception.toString();
      } else {
        if (exception.name) {
          data.name = exception.name;
        } else {
          data.name = 'UnknownError';
        }
        if (exception.message) {
          data.message = exception.message;
        }
        if (exception.lineNumber) {
          data.lineNumber = exception.lineNumber;
          if (exception.columnNumber) {
            data.columnNumber = exception.columnNumber;
          }
        } else if (exception.stack) {
          const lineInfoRegexp = /(.*<anonymous>):(\d*)(:)?(\d*)?/g;
          const lineInfoGroups = lineInfoRegexp.exec(exception.stack);
          if (lineInfoGroups != null && lineInfoGroups.length >= 3) {
            if (isUndefined(lineOffset)) {
              lineOffset = -2;
            }
            data.lineNumber = Number(lineInfoGroups[2]) + lineOffset;
            if (lineInfoGroups.length >= 5) {
              data.columnNumber = Number(lineInfoGroups[4]);
            }
          }
        }
      }
    }
    return data;
  }

  public customTranslation(translationValue: string, defaultValue: string): string {
    if (translationValue && isString(translationValue)) {
      if (translationValue.includes(`{${i18nPrefix}`)) {
        const matches = translationValue.match(i18nRegExp);
        let result = translationValue;
        for (const match of matches) {
          const translationId = match.substring(6, match.length - 1);
          result = result.replace(match, this.doTranslate(translationId, match));
        }
        return result;
      } else {
        return this.doTranslate(translationValue, defaultValue, customTranslationsPrefix);
      }
    } else {
      return translationValue;
    }
  }

  private doTranslate(translationValue: string, defaultValue: string, prefix?: string): string {
    let result: string;
    let translationId;
    if (prefix) {
      translationId = prefix + translationValue;
    } else {
      translationId = translationValue;
    }
    const translation = this.translate.instant(translationId);
    if (translation !== translationId) {
      result = translation + '';
    } else {
      result = defaultValue;
    }
    return result;
  }

  public guid(): string {
    return guid();
  }

  public validateDatasources(datasources: Array<Datasource>): Array<Datasource> {
    datasources.forEach((datasource) => {
      if (datasource.type === DatasourceType.device) {
        if (datasource.deviceAliasId) {
          datasource.type = DatasourceType.entity;
          datasource.entityAliasId = datasource.deviceAliasId;
        }
        if (datasource.deviceName) {
          datasource.entityName = datasource.deviceName;
        }
      }
      if (datasource.type === DatasourceType.entity && datasource.entityId) {
        datasource.name = datasource.entityName;
      }
      if (!datasource.dataKeys) {
        datasource.dataKeys = [];
      }
      datasource.dataKeys.forEach(dataKey => {
        if (isUndefined(dataKey.label)) {
          dataKey.label = dataKey.name;
        }
      });
    });
    return datasources;
  }

  public getMaterialColor(index: number) {
    const colorIndex = index % materialColors.length;
    return materialColors[colorIndex].value;
  }

  public createKey(keyInfo: KeyInfo, type: DataKeyType, index: number = -1): DataKey {
    let label;
    if (type === DataKeyType.alarm && !keyInfo.label) {
      const alarmField = alarmFields[keyInfo.name];
      if (alarmField) {
        label = this.translate.instant(alarmField.name);
      }
    }
    if (!label) {
      label = keyInfo.label || keyInfo.name;
    }
    const dataKey: DataKey = {
      name: keyInfo.name,
      type,
      label,
      funcBody: keyInfo.funcBody,
      settings: {},
      _hash: Math.random()
    };
    if (keyInfo.units) {
      dataKey.units = keyInfo.units;
    }
    if (isDefined(keyInfo.decimals)) {
      dataKey.decimals = keyInfo.decimals;
    }
    if (keyInfo.color) {
      dataKey.color = keyInfo.color;
    } else if (index > -1) {
      dataKey.color = this.getMaterialColor(index);
    }
    if (keyInfo.postFuncBody && keyInfo.postFuncBody.length) {
      dataKey.usePostProcessing = true;
      dataKey.postFuncBody = keyInfo.postFuncBody;
    }
    return dataKey;
  }

  /* public createAdditionalDataKey(dataKey: DataKey, datasource: Datasource, timeUnit: string,
    datasources: Datasource[], additionalKeysNumber: number): DataKey {
    const additionalDataKey = deepClone(dataKey);
    if (dataKey.settings.comparisonSettings.comparisonValuesLabel) {
      additionalDataKey.label = createLabelFromDatasource(datasource, dataKey.settings.comparisonSettings.comparisonValuesLabel);
    } else {
      additionalDataKey.label = dataKey.label + ' ' + this.translate.instant('legend.comparison-time-ago.' + timeUnit);
    }
    additionalDataKey.pattern = additionalDataKey.label;
    if (dataKey.settings.comparisonSettings.color) {
      additionalDataKey.color = dataKey.settings.comparisonSettings.color;
    } else {
      const index = datasources.map((_datasource) => datasource.dataKeys.length)
        .reduce((previousValue, currentValue) => previousValue + currentValue, 0);
      additionalDataKey.color = this.getMaterialColor(index + additionalKeysNumber);
    }
    additionalDataKey._hash = Math.random();
    return additionalDataKey;
  }*/

  public createLabelFromDatasource(datasource: Datasource, pattern: string): string {
    return createLabelFromDatasource(datasource, pattern);
  }

  public generateColors(datasources: Array<Datasource>) {
    let index = 0;
    datasources.forEach((datasource) => {
      datasource.dataKeys.forEach((dataKey) => {
        if (!dataKey.color) {
          dataKey.color = this.getMaterialColor(index);
        }
        index++;
      });
    });
  }

  public stringToHslColor(str: string, saturationPercentage: number, lightnessPercentage: number): string {
    if (str && str.length) {
      const hue = hashCode(str) % 360;
      return `hsl(${hue}, ${saturationPercentage}%, ${lightnessPercentage}%)`;
    }
  }

  public currentPerfTime(): number {
    return this.window.performance && this.window.performance.now ?
      this.window.performance.now() : Date.now();
  }

  public getQueryParam(name: string): string {
    const url = this.window.location.href;
    name = name.replace(/[\[\]]/g, '\\$&');
    const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)');
    const results = regex.exec(url);
    if (!results) {
      return null;
    }
    if (!results[2]) {
      return '';
    }
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
  }

  public removeQueryParams(keys: Array<string>) {
    let params = this.window.location.search;
    for (const key of keys) {
      params = this.updateUrlQueryString(params, key, null);
    }
    const baseUrlPart = [baseUrl(), this.window.location.pathname].join('');
    this.window.history.replaceState({}, '', baseUrlPart + params);
  }

  public updateQueryParam(name: string, value: string | null) {
    const baseUrlPart = [baseUrl(), this.window.location.pathname].join('');
    const urlQueryString = this.window.location.search;
    const params = this.updateUrlQueryString(urlQueryString, name, value);
    this.window.history.replaceState({}, '', baseUrlPart + params);
  }

  private updateUrlQueryString(urlQueryString: string, name: string, value: string | null): string {
    let newParam = '';
    let params = '';
    if (value !== null) {
      newParam = name + '=' + value;
    }
    if (urlQueryString) {
      const keyRegex = new RegExp('([\?&])' + name + '[^&]*');
      if (urlQueryString.match(keyRegex) !== null) {
        if (newParam) {
          newParam = '$1' + newParam;
        }
        params = urlQueryString.replace(keyRegex, newParam);
        if (params.startsWith('&')) {
          params = '?' + params.substring(1);
        }
      } else if (newParam) {
        params = urlQueryString + '&' + newParam;
      }
    } else if (newParam) {
      params = '?' + newParam;
    }
    return params;
  }

  public baseUrl(): string {
    return baseUrl();
  }

  public deepClone<T>(target: T, ignoreFields?: string[]): T {
    return deepClone(target, ignoreFields);
  }

  public isUndefined(value: any): boolean {
    return isUndefined(value);
  }

  public isDefined(value: any): boolean {
    return isDefined(value);
  }

  public defaultValue(value: any, defaultValue: any): any {
    if (isDefinedAndNotNull(value)) {
      return value;
    } else {
      return defaultValue;
    }
  }

  private getEntityIdFromDatasource(dataSource: Datasource): EntityId {
    return {id: dataSource.entityId, entityType: dataSource.entityType};
  }

  public subscribeToEntityTelemetry(ctx: WidgetContext,
                                    entityId?: EntityId,
                                    type: TelemetryType = LatestTelemetry.LATEST_TELEMETRY,
                                    keys: string[] = null): Observable<Array<AttributeData>> {
    if (!entityId && ctx.datasources.length > 0) {
      entityId = this.getEntityIdFromDatasource(ctx.datasources[0]);
    }
    const subscription = TelemetrySubscriber.createEntityAttributesSubscription(ctx.telemetryWsService, entityId, type, ctx.ngZone, keys);
    if (!ctx.telemetrySubscribers) {
      ctx.telemetrySubscribers = [];
    }
    ctx.telemetrySubscribers.push(subscription);
    subscription.subscribe();
    return subscription.attributeData$().pipe(
      publishReplay(1),
      refCount()
    );
  }

  public objToBase64(obj: any): string {
    return objToBase64(obj);
  }

  public base64toString(b64Encoded: string): string {
    return base64toString(b64Encoded);
  }

  public objToBase64URI(obj: any): string {
    return objToBase64URI(obj);
  }

  public base64toObj(b64Encoded: string): any {
    return base64toObj(b64Encoded);
  }

  public updateOverlayMaxHeigth(overlay: OverlayRef, observeElementRef?: ElementRef): Subscription {
    const observeElement = observeElementRef ? observeElementRef.nativeElement : overlay.overlayElement.children[0];

    const setMaxHeigthOverlay = () => {
      const top = observeElement.getBoundingClientRect().top;
      const viewport = window.innerHeight;
      overlay.updateSize({
        maxHeight: viewport - top
      });
    };

    const observer = new ResizeObserver(() => {
      setMaxHeigthOverlay();
      observer.unobserve(observeElement);
    });
    observer.observe(observeElement);

    return fromEvent(window, 'resize').subscribe(() => setMaxHeigthOverlay());
  }

}
