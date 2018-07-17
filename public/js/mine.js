function checkPostRequest(){
    var url = document.forms['postRequest']['url'].value;
    var title = document.forms['postRequest']['title'].value;
    if(title==""){
        alert("Please add a title.");
        return false;
    }
    if(!url.match(/^http.?:\/\/.*?\.?.*\.[a-z]+.*[^\.]$/)){
        alert('Invalid URL. Input full URL as http://www.domain.com');
        return false;
    }
}

function checkEarnPoints(){
    var url = document.forms['earnPoints']['url'].value;
    if(!url.match(/^http.?:\/\/.*?\.?.*\.[a-z]+.*[^\.]$/)){
        alert('Invalid URL. Input full URL as http://www.domain.com');
        return false;
    }
}
