import * as React from 'react';
import * as _ from 'lodash';
import $ from 'jquery';
import URL from 'url';
import { inject, observer } from 'mobx-react';
import {
    action,
    computed,
    observable,
    reaction,
    runInAction,
    makeObservable,
} from 'mobx';
import { ResultsViewPageStore } from './ResultsViewPageStore';
import CancerSummaryContainer from 'pages/resultsView/cancerSummary/CancerSummaryContainer';
import Mutations from './mutation/Mutations';
import MutualExclusivityTab from './mutualExclusivity/MutualExclusivityTab';
import DownloadTab from './download/DownloadTab';
import AppConfig from 'appConfig';
import CNSegments from './cnSegments/CNSegments';
import './styles.scss';
import ResultsViewPathwayMapper from './pathwayMapper/ResultsViewPathwayMapper';
import ResultsViewOncoprint from 'shared/components/oncoprint/ResultsViewOncoprint';
import QuerySummary from './querySummary/QuerySummary';
import ExpressionWrapper from './expression/ExpressionWrapper';
import PlotsTab from './plots/PlotsTab';
import { MSKTab, MSKTabs } from '../../shared/components/MSKTabs/MSKTabs';
import { PageLayout } from '../../shared/components/PageLayout/PageLayout';
import autobind from 'autobind-decorator';
import { ITabConfiguration } from '../../shared/model/ITabConfiguration';
import { getBrowserWindow, remoteData } from 'cbioportal-frontend-commons';
import CoExpressionTab from './coExpression/CoExpressionTab';
import Helmet from 'react-helmet';
import { showCustomTab } from '../../shared/lib/customTabs';
import {
    parseConfigDisabledTabs,
    ResultsViewTab,
} from './ResultsViewPageHelpers';
import {
    buildResultsViewPageTitle,
    doesQueryHaveCNSegmentData,
} from './ResultsViewPageStoreUtils';
import { AppStore } from '../../AppStore';
import { trackQuery } from '../../shared/lib/tracking';
import QueryAndDownloadTabs from 'shared/components/query/QueryAndDownloadTabs';
import ExtendedRouterStore from 'shared/lib/ExtendedRouterStore';
import GeneSymbolValidationError from 'shared/components/query/GeneSymbolValidationError';
import ResultsViewURLWrapper from 'pages/resultsView/ResultsViewURLWrapper';
import setWindowVariable from 'shared/lib/setWindowVariable';
import LoadingIndicator from 'shared/components/loadingIndicator/LoadingIndicator';
import onMobxPromise from 'shared/lib/onMobxPromise';
import { createQueryStore } from 'shared/lib/createQueryStore';
import {
    handleLegacySubmission,
    handlePostedSubmission,
} from 'shared/lib/redirectHelpers';
import ComparisonTab from './comparison/ComparisonTab';
import OQLTextArea, {
    GeneBoxType,
} from 'shared/components/GeneSelectionBox/OQLTextArea';
import browser from 'bowser';
import { QueryStore } from '../../shared/components/query/QueryStore';
import UserMessager from 'shared/components/userMessager/UserMessage';

export function initStore(
    appStore: AppStore,
    urlWrapper: ResultsViewURLWrapper
) {
    const resultsViewPageStore = new ResultsViewPageStore(appStore, urlWrapper);

    setWindowVariable('resultsViewPageStore', resultsViewPageStore);

    reaction(
        () => [resultsViewPageStore.studyIds, resultsViewPageStore.oqlText],
        () => {
            if (
                resultsViewPageStore.studyIds.isComplete &&
                resultsViewPageStore.oqlText
            ) {
                trackQuery(
                    resultsViewPageStore.studyIds.result!,
                    resultsViewPageStore.oqlText,
                    resultsViewPageStore.hugoGeneSymbols,
                    resultsViewPageStore.queriedVirtualStudies.result!.length >
                        0
                );
            }
        }
    );

    return resultsViewPageStore;
}

function addOnBecomeVisibleListener(callback: () => void) {
    $('#oncoprint-result-tab').click(callback);
}

export interface IResultsViewPageProps {
    routing: ExtendedRouterStore;
    appStore: AppStore;
    params: any; // from react router
}

@inject('appStore', 'routing')
@observer
export default class ResultsViewPage extends React.Component<
    IResultsViewPageProps,
    {}
> {
    private resultsViewPageStore: ResultsViewPageStore;

    private urlWrapper: ResultsViewURLWrapper;

    @observable.ref quickOQLQueryStore: QueryStore | null = null;

    @observable showTabs = true;

    constructor(props: IResultsViewPageProps) {
        super(props);

        makeObservable(this);

        this.urlWrapper = new ResultsViewURLWrapper(props.routing);

        handleLegacySubmission(this.urlWrapper);

        handlePostedSubmission(this.urlWrapper);

        setWindowVariable('urlWrapper', this.urlWrapper);

        if (this.urlWrapper.hasSessionId) {
            onMobxPromise(this.urlWrapper.remoteSessionData, () => {
                this.resultsViewPageStore = initStore(
                    props.appStore,
                    this.urlWrapper
                );
            });
        } else {
            this.resultsViewPageStore = initStore(
                props.appStore,
                this.urlWrapper
            );
        }
    }

    @autobind
    private customTabCallback(
        div: HTMLDivElement,
        tab: any,
        isUnmount = false
    ) {
        showCustomTab(
            div,
            tab,
            getBrowserWindow().location.href,
            this.resultsViewPageStore,
            isUnmount
        );
    }

    componentWillUnmount() {
        this.resultsViewPageStore.destroy();
        this.urlWrapper.destroy();
    }

    @computed
    private get tabs() {
        const store = this.resultsViewPageStore;

        const tabMap: ITabConfiguration[] = [
            {
                id: ResultsViewTab.ONCOPRINT,
                getTab: () => {
                    return (
                        <MSKTab
                            key={0}
                            id={ResultsViewTab.ONCOPRINT}
                            linkText="OncoPrint"
                        >
                            <ResultsViewOncoprint
                                divId={'oncoprintDiv'}
                                store={store}
                                urlWrapper={store.urlWrapper}
                                key={store.hugoGeneSymbols.join(',')}
                                addOnBecomeVisibleListener={
                                    addOnBecomeVisibleListener
                                }
                            />
                        </MSKTab>
                    );
                },
            },

            {
                id: ResultsViewTab.CANCER_TYPES_SUMMARY,
                getTab: () => {
                    return (
                        <MSKTab
                            key={1}
                            id={ResultsViewTab.CANCER_TYPES_SUMMARY}
                            linkText="Cancer Types Summary"
                        >
                            <CancerSummaryContainer store={store} />
                        </MSKTab>
                    );
                },
            },

            {
                id: ResultsViewTab.MUTUAL_EXCLUSIVITY,
                getTab: () => {
                    return (
                        <MSKTab
                            key={5}
                            id={ResultsViewTab.MUTUAL_EXCLUSIVITY}
                            linkText="Mutual Exclusivity"
                        >
                            <MutualExclusivityTab
                                store={store}
                                isSampleAlteredMap={store.isSampleAlteredMap}
                            />
                        </MSKTab>
                    );
                },
                hide: () => {
                    // we are using the size of isSampleAlteredMap as a proxy for the number of things we have to compare
                    return (
                        !this.resultsViewPageStore.isSampleAlteredMap
                            .isComplete ||
                        _.size(
                            this.resultsViewPageStore.isSampleAlteredMap.result
                        ) < 2
                    );
                },
            },

            {
                id: ResultsViewTab.PLOTS,
                getTab: () => {
                    return (
                        <MSKTab
                            key={12}
                            id={ResultsViewTab.PLOTS}
                            linkText={'Plots'}
                        >
                            <PlotsTab
                                store={store}
                                urlWrapper={this.urlWrapper}
                            />
                        </MSKTab>
                    );
                },
            },

            {
                id: ResultsViewTab.MUTATIONS,
                getTab: () => {
                    return (
                        <MSKTab
                            key={3}
                            id={ResultsViewTab.MUTATIONS}
                            linkText="Mutations"
                        >
                            <Mutations
                                store={store}
                                appStore={this.props.appStore}
                                urlWrapper={this.urlWrapper}
                            />
                        </MSKTab>
                    );
                },
            },

            {
                id: ResultsViewTab.COEXPRESSION,
                hide: () => {
                    if (
                        !this.resultsViewPageStore.isThereDataForCoExpressionTab
                            .isComplete ||
                        !this.resultsViewPageStore.studies.isComplete
                    ) {
                        return true;
                    } else {
                        const tooManyStudies =
                            this.resultsViewPageStore.studies.result!.length >
                            1;
                        const noData = !this.resultsViewPageStore
                            .isThereDataForCoExpressionTab.result;
                        return tooManyStudies || noData;
                    }
                },
                getTab: () => {
                    return (
                        <MSKTab
                            key={7}
                            id={ResultsViewTab.COEXPRESSION}
                            linkText={'Co-expression'}
                        >
                            <CoExpressionTab store={store} />
                        </MSKTab>
                    );
                },
            },

            {
                id: ResultsViewTab.COMPARISON,
                hide: () => {
                    return this.resultsViewPageStore.survivalClinicalDataExists
                        .isPending;
                },
                getTab: () => {
                    const text = this.resultsViewPageStore
                        .survivalClinicalDataExists.result
                        ? 'Comparison/Survival'
                        : 'Comparison';
                    return (
                        <MSKTab
                            key={10}
                            id={ResultsViewTab.COMPARISON}
                            linkText={text}
                        >
                            <ComparisonTab
                                urlWrapper={this.urlWrapper}
                                appStore={this.props.appStore}
                                store={this.resultsViewPageStore}
                            />
                        </MSKTab>
                    );
                },
            },
            {
                id: ResultsViewTab.CN_SEGMENTS,
                hide: () => {
                    return (
                        !this.resultsViewPageStore.studies.isComplete ||
                        !this.resultsViewPageStore.genes.isComplete ||
                        !this.resultsViewPageStore.referenceGenes.isComplete ||
                        !doesQueryHaveCNSegmentData(
                            this.resultsViewPageStore.samples.result
                        )
                    );
                },
                getTab: () => {
                    return (
                        <MSKTab
                            key={6}
                            id={ResultsViewTab.CN_SEGMENTS}
                            linkText="CN Segments"
                        >
                            <CNSegments store={store} />
                        </MSKTab>
                    );
                },
            },

            {
                id: ResultsViewTab.NETWORK,
                hide: () => {
                    return true;
                },
                getTab: () => {
                    return (
                        <MSKTab
                            key={9}
                            id={ResultsViewTab.NETWORK}
                            linkText={'Network'}
                        >
                            <div className="alert alert-info">
                                The Network tab has been retired. For similar
                                functionality, please visit{' '}
                                <a
                                    href="http://www.pathwaycommons.org/pcviz/"
                                    target="_blank"
                                >
                                    http://www.pathwaycommons.org/pcviz/
                                </a>
                            </div>
                        </MSKTab>
                    );
                },
            },
            {
                id: ResultsViewTab.PATHWAY_MAPPER,
                hide: () =>
                    browser.name === 'Internet Explorer' ||
                    !AppConfig.serverConfig.show_pathway_mapper ||
                    !this.resultsViewPageStore.studies.isComplete,
                getTab: () => {
                    const showPM =
                        store.filteredSequencedSampleKeysByGene.isComplete &&
                        store.oqlFilteredCaseAggregatedDataByOQLLine
                            .isComplete &&
                        store.genes.isComplete &&
                        store.samples.isComplete &&
                        store.patients.isComplete &&
                        store.coverageInformation.isComplete &&
                        store.filteredSequencedSampleKeysByGene.isComplete &&
                        store.filteredSequencedPatientKeysByGene.isComplete &&
                        store.selectedMolecularProfiles.isComplete &&
                        store.oqlFilteredCaseAggregatedDataByUnflattenedOQLLine
                            .isComplete;

                    return (
                        <MSKTab
                            key={13}
                            id={ResultsViewTab.PATHWAY_MAPPER}
                            linkText={'Pathways'}
                        >
                            {showPM ? (
                                <ResultsViewPathwayMapper
                                    store={store}
                                    appStore={this.props.appStore}
                                    urlWrapper={this.urlWrapper}
                                />
                            ) : (
                                <LoadingIndicator
                                    isLoading={true}
                                    size={'big'}
                                    center={true}
                                />
                            )}
                        </MSKTab>
                    );
                },
            },
            {
                id: ResultsViewTab.DOWNLOAD,
                getTab: () => {
                    return (
                        <MSKTab
                            key={11}
                            id={ResultsViewTab.DOWNLOAD}
                            linkText={'Download'}
                        >
                            <DownloadTab store={store} />
                        </MSKTab>
                    );
                },
            },
        ];

        let filteredTabs = tabMap
            .filter(this.evaluateTabInclusion)
            .map(tab => tab.getTab());

        // now add custom tabs
        if (AppConfig.serverConfig.custom_tabs) {
            const customResultsTabs = AppConfig.serverConfig.custom_tabs
                .filter((tab: any) => tab.location === 'RESULTS_PAGE')
                .map((tab: any, i: number) => {
                    return (
                        <MSKTab
                            key={100 + i}
                            id={'customTab' + i}
                            unmountOnHide={tab.unmountOnHide === true}
                            onTabDidMount={div => {
                                this.customTabCallback(div, tab);
                            }}
                            onTabUnmount={div => {
                                this.customTabCallback(div, tab, true);
                            }}
                            linkText={tab.title}
                        />
                    );
                });
            filteredTabs = filteredTabs.concat(customResultsTabs);
        }

        return filteredTabs;
    }

    @autobind
    public evaluateTabInclusion(tab: ITabConfiguration) {
        const excludedTabs = AppConfig.serverConfig.disabled_tabs || '';
        const isExcludedInList = parseConfigDisabledTabs(excludedTabs).includes(
            tab.id
        );
        const isRoutedTo = this.resultsViewPageStore.tabId === tab.id;
        const isExcluded = tab.hide ? tab.hide() : false;

        // we show no matter what if its routed to
        return isRoutedTo || (!isExcludedInList && !isExcluded);
    }

    @computed get quickOQLSubmitButton() {
        if (this.quickOQLQueryStore) {
            return (
                <>
                    <button
                        className={'btn btn-primary btn-sm'}
                        data-test="oqlQuickEditSubmitButton"
                        style={{ marginLeft: 10 }}
                        onClick={this.handleQuickOQLSubmission}
                        disabled={!this.quickOQLQueryStore!.submitEnabled}
                    >
                        Submit Query
                    </button>
                    &nbsp;
                    <button
                        className={'btn btn-link btn-sm'}
                        onClick={this.toggleOQLEditor}
                    >
                        Cancel
                    </button>
                </>
            );
        }
    }

    @computed get showOQLEditor() {
        return !!this.quickOQLQueryStore;
    }
    set showOQLEditor(s: boolean) {
        if (s) {
            this.quickOQLQueryStore = createQueryStore(
                this.urlWrapper.query,
                this.urlWrapper,
                false
            );
        } else {
            this.quickOQLQueryStore = null;
        }
    }

    @action.bound
    handleQuickOQLSubmission() {
        this.quickOQLQueryStore!.submit();
        this.showOQLEditor = false;
    }

    @action.bound
    toggleOQLEditor() {
        this.showOQLEditor = !this.showOQLEditor;
    }

    @autobind
    private getTabHref(tabId: string) {
        return URL.format({
            pathname: tabId,
            query: this.props.routing.query,
            hash: this.props.routing.location.hash,
        });
    }

    readonly userMessages = remoteData({
        await: () => [
            this.resultsViewPageStore.expressionProfiles,
            this.resultsViewPageStore.studies,
        ],
        invoke: () => {
            // TODO: This is only here temporarily to shepherd users from
            //      now-deleted Expression tab to the Plots tab.
            //  Remove a few months after 10/2020
            if (
                this.resultsViewPageStore.expressionProfiles.result.length >
                    0 &&
                this.resultsViewPageStore.studies.result.length > 1
            ) {
                return Promise.resolve([
                    {
                        dateEnd: 10000000000000000000,
                        content: (
                            <span>
                                Looking for the <strong>Expression</strong> tab?
                                {` `}
                                That functionality is now available{` `}
                                <a
                                    style={{
                                        color: 'white',
                                        textDecoration: 'underline',
                                    }}
                                    onClick={() =>
                                        this.urlWrapper.updateURL(
                                            {},
                                            `results/${ResultsViewTab.EXPRESSION_REDIRECT}`
                                        )
                                    }
                                >
                                    in the <strong>Plots</strong> tab.
                                </a>
                            </span>
                        ),
                        id: '2020_merge_expression_to_plots',
                    },
                ]);
            } else {
                return Promise.resolve([]);
            }
        },
    });

    @computed get pageContent() {
        if (this.resultsViewPageStore.invalidStudyIds.result.length > 0) {
            return (
                <div>
                    <div className={'headBlock'}></div>
                    <QueryAndDownloadTabs
                        forkedMode={false}
                        showQuickSearchTab={false}
                        showDownloadTab={false}
                        showAlerts={true}
                        getQueryStore={() =>
                            createQueryStore(
                                this.urlWrapper.query,
                                this.urlWrapper
                            )
                        }
                    />
                </div>
            );
        } else {
            // we don't show the result tabs if we don't have valid query
            const tabsReady =
                this.showTabs &&
                !this.resultsViewPageStore.genesInvalid &&
                !this.resultsViewPageStore.isQueryInvalid &&
                this.resultsViewPageStore.customDriverAnnotationReport
                    .isComplete;
            return (
                <>
                    {// if query invalid(we only check gene count * sample count < 1,000,000 for now), return error page
                    this.resultsViewPageStore.isQueryInvalid && (
                        <div
                            className="alert alert-danger queryInvalid"
                            style={{ marginBottom: '40px' }}
                            role="alert"
                        >
                            <GeneSymbolValidationError
                                sampleCount={
                                    this.resultsViewPageStore.samples.result
                                        .length
                                }
                                queryProductLimit={
                                    AppConfig.serverConfig.query_product_limit
                                }
                                email={
                                    AppConfig.serverConfig.skin_email_contact
                                }
                            />
                        </div>
                    )}

                    {this.userMessages.isComplete &&
                        this.userMessages.result.length > 0 && (
                            <UserMessager messages={this.userMessages.result} />
                        )}

                    {(this.resultsViewPageStore.studies.isPending ||
                        !tabsReady) && (
                        <LoadingIndicator
                            isLoading={true}
                            center={true}
                            noFade={true}
                            size={'big'}
                        ></LoadingIndicator>
                    )}
                    {this.resultsViewPageStore.studies.isComplete && (
                        <>
                            <Helmet>
                                <title>
                                    {buildResultsViewPageTitle(
                                        this.resultsViewPageStore
                                            .hugoGeneSymbols,
                                        this.resultsViewPageStore.studies.result
                                    )}
                                </title>
                            </Helmet>
                            <div>
                                <div className={'headBlock'}>
                                    <QuerySummary
                                        routingStore={this.props.routing}
                                        store={this.resultsViewPageStore}
                                        onToggleQueryFormVisibility={visible => {
                                            runInAction(() => {
                                                this.showTabs = visible;
                                                this.showOQLEditor = false;
                                            });
                                        }}
                                        onToggleOQLEditUIVisibility={
                                            this.toggleOQLEditor
                                        }
                                    />

                                    {this.showOQLEditor && (
                                        <div className={'quick_oql_edit'}>
                                            <OQLTextArea
                                                validateInputGeneQuery={true}
                                                inputGeneQuery={
                                                    this.quickOQLQueryStore!
                                                        .geneQuery
                                                }
                                                callback={(...args) => {
                                                    this.quickOQLQueryStore!.geneQuery =
                                                        args[2];
                                                }}
                                                location={GeneBoxType.DEFAULT}
                                                submitButton={
                                                    this.quickOQLSubmitButton
                                                }
                                                error={
                                                    this.quickOQLQueryStore!
                                                        .submitError
                                                }
                                                messages={
                                                    this.quickOQLQueryStore!
                                                        .oqlMessages
                                                }
                                            />
                                        </div>
                                    )}
                                </div>
                                {tabsReady && (
                                    <MSKTabs
                                        key={this.urlWrapper.hash}
                                        activeTabId={
                                            this.resultsViewPageStore.tabId
                                        }
                                        unmountOnHide={false}
                                        onTabClick={(id: string) =>
                                            this.resultsViewPageStore.handleTabChange(
                                                id
                                            )
                                        }
                                        className="mainTabs"
                                        getTabHref={this.getTabHref}
                                    >
                                        {this.tabs}
                                    </MSKTabs>
                                )}
                            </div>
                        </>
                    )}
                </>
            );
        }
    }

    public render() {
        if (
            this.urlWrapper.isTemporarySessionPendingSave ||
            this.urlWrapper.isLoadingSession ||
            !this.resultsViewPageStore.studies.isComplete
        ) {
            return (
                <LoadingIndicator
                    isLoading={true}
                    center={true}
                    noFade={true}
                    size={'big'}
                />
            );
        }

        if (
            this.resultsViewPageStore.studies.isComplete &&
            !this.resultsViewPageStore.tabId
        ) {
            setTimeout(() => {
                this.resultsViewPageStore.handleTabChange(
                    this.resultsViewPageStore.tabId,
                    true
                );
            });
            return null;
        } else {
            return (
                <PageLayout
                    noMargin={true}
                    hideFooter={true}
                    className={'subhead-dark'}
                >
                    {this.pageContent}
                </PageLayout>
            );
        }
    }
}
