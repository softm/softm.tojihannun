#!/usr/bin/env python3
"""Check prerequisites without reading Secret APIs or exposing key values."""
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

def check():
    repo=os.environ.get('GITHUB_REPOSITORY','')
    if not re.fullmatch(r'softm/realestate-data-\d{3}',repo): raise ValueError('Unexpected repository')
    token=os.environ.get('GH_TOKEN','')
    result={'schemaVersion':1,'repository':repo,'checkedAt':datetime.now(timezone.utc).isoformat(),
            'apiKeyConfigured':bool(os.environ.get('MOLIT_API_KEY','').strip()),'apiAccessVerified':False,
            'pagesConfigured':None,'pagesBuildType':None,'pagesCheckError':None,
            'note':'Secret presence only; not an API permission or complete-collection claim.'}
    request=urllib.request.Request('https://api.github.com/repos/'+repo+'/pages',headers={
        'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'})
    try:
        with urllib.request.urlopen(request,timeout=20) as response: metadata=json.load(response)
        result['pagesBuildType']=metadata.get('build_type')
        result['pagesConfigured']=metadata.get('build_type')=='workflow'
    except urllib.error.HTTPError as error:
        result['pagesCheckError']='HTTP_'+str(error.code)
    except (OSError,ValueError): result['pagesCheckError']='CHECK_UNAVAILABLE'
    Path('readiness.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False))
    return result

if __name__=='__main__': check()
